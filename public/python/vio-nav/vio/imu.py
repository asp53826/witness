"""IMU model and preintegration.

An IMU at 200 Hz between camera frames at 20 Hz means ten inertial samples per
image. Re-integrating them every time the estimator changes its mind about the
initial state would make the whole thing intractable, so instead the interval
is summarised once into a relative motion increment that does not depend on
the starting pose or velocity:

    dR = product of Exp(w dt)
    dv = sum of dR_i a_i dt
    dp = sum of (dv_i dt + 0.5 dR_i a_i dt^2)

Those depend only on the measurements and the *bias*. The bias estimate does
keep changing, and that is what the Jacobians below are for: a first-order
correction that shifts the increment to a new bias without touching the raw
samples again.

Gravity is deliberately absent. It is added back at the point of use, because
including it here would tie the increment to the world frame and destroy the
independence that makes preintegration worth doing.
"""

import numpy as np

from .lie import exp_so3, hat, normalise, right_jacobian

GRAVITY = np.array([0.0, 0.0, -9.81])


class ImuNoise:
    """Continuous-time noise densities, the units a datasheet actually uses.

    gyro/accel white noise are in rad/s/sqrt(Hz) and m/s^2/sqrt(Hz); the walk
    terms are the bias instability. Defaults are roughly a decent MEMS part.
    """

    def __init__(self, gyro=1.7e-4, accel=2.0e-3,
                 gyro_walk=2.0e-5, accel_walk=3.0e-3):
        self.gyro = gyro
        self.accel = accel
        self.gyro_walk = gyro_walk
        self.accel_walk = accel_walk

    def discrete(self, dt):
        """White noise covariance for one step of length dt."""
        return np.diag([
            self.gyro ** 2 / dt, self.gyro ** 2 / dt, self.gyro ** 2 / dt,
            self.accel ** 2 / dt, self.accel ** 2 / dt, self.accel ** 2 / dt,
        ])


class Preintegrated:
    """One inter-frame inertial increment, with covariance and bias Jacobians."""

    def __init__(self, bg, ba, noise=None):
        self.bg = np.asarray(bg, dtype=float).copy()
        self.ba = np.asarray(ba, dtype=float).copy()
        self.noise = noise or ImuNoise()

        self.dR = np.eye(3)
        self.dv = np.zeros(3)
        self.dp = np.zeros(3)
        self.dt = 0.0

        # covariance over [dtheta, dv, dp]
        self.P = np.zeros((9, 9))

        # d(increment) / d(bias), for the first-order bias correction
        self.dR_dbg = np.zeros((3, 3))
        self.dv_dbg = np.zeros((3, 3))
        self.dv_dba = np.zeros((3, 3))
        self.dp_dbg = np.zeros((3, 3))
        self.dp_dba = np.zeros((3, 3))

    def integrate(self, gyro, accel, dt):
        """Fold in one IMU sample. Midpoint-free, first-order Euler on SO(3)."""
        w = np.asarray(gyro, dtype=float) - self.bg
        a = np.asarray(accel, dtype=float) - self.ba

        dR_step = exp_so3(w * dt)
        Jr = right_jacobian(w * dt)

        # -- covariance and bias Jacobians use the *pre-update* dR ----------
        A = np.eye(9)
        A[0:3, 0:3] = dR_step.T
        A[3:6, 0:3] = -self.dR @ hat(a) * dt
        A[6:9, 0:3] = -0.5 * self.dR @ hat(a) * dt * dt
        A[6:9, 3:6] = np.eye(3) * dt

        B = np.zeros((9, 6))
        B[0:3, 0:3] = Jr * dt
        B[3:6, 3:6] = self.dR * dt
        B[6:9, 3:6] = 0.5 * self.dR * dt * dt

        self.P = A @ self.P @ A.T + B @ self.noise.discrete(dt) @ B.T

        # bias Jacobians, same recursion (Forster et al., eq. 39-40)
        self.dp_dbg = (self.dp_dbg + self.dv_dbg * dt
                       - 0.5 * self.dR @ hat(a) @ self.dR_dbg * dt * dt)
        self.dp_dba = (self.dp_dba + self.dv_dba * dt
                       - 0.5 * self.dR * dt * dt)
        self.dv_dbg = self.dv_dbg - self.dR @ hat(a) @ self.dR_dbg * dt
        self.dv_dba = self.dv_dba - self.dR * dt
        self.dR_dbg = dR_step.T @ self.dR_dbg - Jr * dt

        # -- state, in this order: dp uses the old dv and old dR ------------
        self.dp = self.dp + self.dv * dt + 0.5 * (self.dR @ a) * dt * dt
        self.dv = self.dv + (self.dR @ a) * dt
        self.dR = normalise(self.dR @ dR_step)
        self.dt += dt
        return self

    # -- use ---------------------------------------------------------------

    def corrected(self, bg, ba):
        """Shift the increment to a new bias, first order.

        This is the whole payoff. Without it, every change to the bias
        estimate would mean re-integrating every sample in the window.
        """
        dbg = np.asarray(bg) - self.bg
        dba = np.asarray(ba) - self.ba
        dR = normalise(self.dR @ exp_so3(self.dR_dbg @ dbg))
        dv = self.dv + self.dv_dbg @ dbg + self.dv_dba @ dba
        dp = self.dp + self.dp_dbg @ dbg + self.dp_dba @ dba
        return dR, dv, dp

    def predict(self, R, v, p, bg=None, ba=None, gravity=GRAVITY):
        """Propagate a navigation state across this increment.

        Gravity enters here and only here.
        """
        dR, dv, dp = (self.corrected(bg, ba) if bg is not None
                      else (self.dR, self.dv, self.dp))
        dt = self.dt
        p_new = p + v * dt + 0.5 * gravity * dt * dt + R @ dp
        v_new = v + gravity * dt + R @ dv
        R_new = normalise(R @ dR)
        return R_new, v_new, p_new


def integrate_direct(R, v, p, samples, bg, ba, gravity=GRAVITY):
    """Straight strapdown integration in the world frame.

    Kept as the reference that preintegration is checked against: the two must
    agree to numerical precision when the bias used matches. It is also the
    dead-reckoning baseline in the benchmark -- the thing VIO has to beat.
    """
    R = np.asarray(R, dtype=float).copy()
    v = np.asarray(v, dtype=float).copy()
    p = np.asarray(p, dtype=float).copy()
    for gyro, accel, dt in samples:
        w = np.asarray(gyro) - bg
        a = np.asarray(accel) - ba
        a_world = R @ a + gravity
        p = p + v * dt + 0.5 * a_world * dt * dt
        v = v + a_world * dt
        R = normalise(R @ exp_so3(w * dt))
    return R, v, p
