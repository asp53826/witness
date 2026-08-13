"""Trajectory, IMU and feature-track simulation.

Trajectories are analytic, so the IMU measurements are exact rather than
numerically differentiated -- otherwise the differentiation error would be
indistinguishable from sensor noise and every accuracy claim would be
measuring the simulator.

The trajectory shapes are chosen for what they excite. A circle turns at
constant rate about one axis and holds constant speed; a figure-eight reverses
its turn and changes speed, which is what makes the accelerometer bias
observable. The difference between them shows up directly in the benchmark.
"""

import numpy as np

from .camera import Camera
from .imu import GRAVITY
from .lie import normalise


class Trajectory:
    """Analytic pose, velocity and acceleration as functions of time."""

    def __init__(self, kind="figure8", radius=6.0, period=20.0, height=2.0):
        self.kind = kind
        self.radius = radius
        self.period = period
        self.height = height

    def position(self, t):
        w = 2.0 * np.pi / self.period
        r = self.radius
        if self.kind == "circle":
            return np.array([r * np.cos(w * t), r * np.sin(w * t), self.height])
        if self.kind == "figure8":
            return np.array([r * np.sin(w * t), r * np.sin(w * t) * np.cos(w * t),
                             self.height + 0.4 * np.sin(2.0 * w * t)])
        if self.kind == "hover":
            return np.array([0.0, 0.0, self.height])
        raise ValueError(self.kind)

    def velocity(self, t, h=1e-6):
        return (self.position(t + h) - self.position(t - h)) / (2.0 * h)

    def acceleration(self, t, h=1e-4):
        return ((self.position(t + h) - 2.0 * self.position(t)
                 + self.position(t - h)) / (h * h))

    def rotation(self, t):
        """Body x forward along velocity, z as close to world-up as possible."""
        v = self.velocity(t)
        speed = np.linalg.norm(v)
        fwd = v / speed if speed > 1e-6 else np.array([1.0, 0.0, 0.0])
        up = np.array([0.0, 0.0, 1.0])
        left = np.cross(up, fwd)
        n = np.linalg.norm(left)
        if n < 1e-6:
            left = np.array([0.0, 1.0, 0.0])
        else:
            left = left / n
        up = np.cross(fwd, left)
        return normalise(np.column_stack([fwd, left, up]))

    def angular_velocity(self, t, h=1e-5):
        """Body-frame rate, from the derivative of the rotation."""
        from .lie import log_so3
        R0, R1 = self.rotation(t - h), self.rotation(t + h)
        return log_so3(R0.T @ R1) / (2.0 * h)

    def imu(self, t):
        """Ideal gyro and accelerometer readings, body frame.

        The accelerometer measures specific force, R^T (a - g), not
        acceleration. A stationary IMU therefore reads +9.81 upward, and
        getting this sign wrong produces a filter that works perfectly in
        simulation right up until it meets gravity.
        """
        R = self.rotation(t)
        gyro = self.angular_velocity(t)
        accel = R.T @ (self.acceleration(t) - GRAVITY)
        return gyro, accel


def make_landmarks(trajectory, n=200, span=None, seed=0, shell=(4.0, 14.0)):
    """Points scattered in a shell around the trajectory's extent."""
    rng = np.random.default_rng(seed)
    span = span or trajectory.period
    samples = np.array([trajectory.position(t)
                        for t in np.linspace(0.0, span, 60)])
    centre = samples.mean(axis=0)
    pts = []
    while len(pts) < n:
        d = rng.normal(size=3)
        d /= np.linalg.norm(d)
        r = rng.uniform(*shell)
        p = centre + d * r
        p[2] = abs(p[2]) * 0.5 + 1.0
        pts.append(p)
    return np.array(pts)


class Dataset:
    """A simulated run: IMU stream, camera frames with feature tracks, truth."""

    def __init__(self, trajectory, landmarks, camera, imu_rate=200.0,
                 cam_rate=20.0, duration=20.0, noise=None, bias=None, seed=0,
                 pixel_noise=1.0):
        self.trajectory = trajectory
        self.landmarks = landmarks
        self.camera = camera
        self.imu_rate = imu_rate
        self.cam_rate = cam_rate
        self.duration = duration
        self.pixel_noise = pixel_noise

        rng = np.random.default_rng(seed)
        self.bg_true, self.ba_true = (bias if bias is not None
                                      else (np.array([0.004, -0.003, 0.002]),
                                            np.array([0.05, -0.04, 0.03])))
        self.noise = noise
        self._build(rng)

    def _build(self, rng):
        n_imu = int(self.duration * self.imu_rate)
        dt = 1.0 / self.imu_rate
        self.imu_t = np.arange(n_imu) * dt
        self.imu_dt = dt

        gyro, accel = [], []
        for t in self.imu_t:
            g, a = self.trajectory.imu(t)
            if self.noise is not None:
                g = g + rng.normal(0.0, self.noise.gyro * np.sqrt(self.imu_rate), 3)
                a = a + rng.normal(0.0, self.noise.accel * np.sqrt(self.imu_rate), 3)
            gyro.append(g + self.bg_true)
            accel.append(a + self.ba_true)
        self.gyro = np.array(gyro)
        self.accel = np.array(accel)

        step = int(round(self.imu_rate / self.cam_rate))
        self.frame_idx = np.arange(0, n_imu, step)
        self.frames = []
        for k in self.frame_idx:
            t = self.imu_t[k]
            R_wb, p_wb = self.trajectory.rotation(t), self.trajectory.position(t)
            R_wc, p_wc = self.camera.world_to_camera(R_wb, p_wb)
            obs = {}
            for j, lm in enumerate(self.landmarks):
                uv = self.camera.observe(lm, R_wc, p_wc)
                if uv is not None:
                    obs[j] = uv + rng.normal(0.0, self.pixel_noise, 2)
            self.frames.append(obs)

    def truth(self, t):
        return (self.trajectory.rotation(t), self.trajectory.velocity(t),
                self.trajectory.position(t))

    @property
    def n_frames(self):
        return len(self.frames)

    def track_stats(self):
        counts = [len(f) for f in self.frames]
        return {"frames": len(counts), "mean_tracks": float(np.mean(counts)),
                "min_tracks": int(np.min(counts))}
