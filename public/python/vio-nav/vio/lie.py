"""SO(3) on the manifold.

Rotation is not a vector space, and pretending otherwise is where most
hand-rolled inertial navigation goes wrong. Euler angles gimbal-lock, and a
naive additive update to a rotation matrix leaves the manifold immediately --
the result is no longer orthonormal, and the drift that introduces looks
exactly like sensor bias, so it gets absorbed into the bias estimate and
quietly corrupts everything downstream.

Everything here works with a rotation on the manifold and its *error* in the
tangent space, which is a genuine 3-vector and can be handled by an ordinary
Kalman filter.

Convention: right perturbation, R_true = R_est * Exp(delta).
"""

import numpy as np


def hat(v):
    """Skew-symmetric matrix: hat(a) @ b == cross(a, b)."""
    x, y, z = v
    return np.array([[0.0, -z, y],
                     [z, 0.0, -x],
                     [-y, x, 0.0]])


def vee(M):
    return np.array([M[2, 1], M[0, 2], M[1, 0]])


def _sinc(t):
    """sin(t)/t, exact at 0. np.sinc is sin(pi x)/(pi x)."""
    return np.sinc(t / np.pi)


def _one_minus_cos_over_t2(t):
    """(1 - cos t) / t^2, without the cancellation.

    Written naively this is the single worst-conditioned expression in the
    file: `1 - cos t` cancels to nothing for small t. At t = 1e-8 the naive
    form returns 0 instead of 0.5 -- a 100% error -- and it is still 8e-5
    wrong at t = 1e-6. Using 1 - cos t = 2 sin^2(t/2) removes the subtraction
    entirely and is exact at t = 0.
    """
    return 0.5 * _sinc(t / 2.0) ** 2


def _t_minus_sin_over_t3(t):
    """(t - sin t) / t^3. No cancellation-free closed form, so use the series
    where the subtraction is unreliable. Below t = 1e-3 the truncation error
    is ~1e-24 while the naive form is already 3e-11 off, and by t = 1e-7 it is
    3% off."""
    if t < 1e-3:
        t2 = t * t
        return 1.0 / 6.0 - t2 / 120.0 + t2 * t2 / 5040.0
    return (t - np.sin(t)) / (t ** 3)


def exp_so3(phi):
    """Rodrigues. Maps a rotation vector to a rotation matrix.

    Branch-free: both coefficients are singular at the identity when written
    directly, and both have stable equivalents. Every filter update evaluates
    this near zero, so the small-angle regime is the common case, not an edge
    case.
    """
    t = float(np.linalg.norm(phi))
    K = hat(phi)
    return (np.eye(3) + _sinc(t) * K
            + _one_minus_cos_over_t2(t) * (K @ K))


def log_so3(R):
    """Inverse of exp_so3, returning a rotation vector with |phi| <= pi."""
    c = (np.trace(R) - 1.0) / 2.0
    c = min(1.0, max(-1.0, c))
    t = np.arccos(c)
    if t < 1e-8:
        return vee(R - R.T) * 0.5
    if np.pi - t < 1e-6:
        # near pi the antisymmetric part vanishes; recover the axis from the
        # symmetric part instead, where it is still well conditioned
        A = (R + np.eye(3)) / 2.0
        axis = np.sqrt(np.maximum(np.diag(A), 0.0))
        k = int(np.argmax(axis))
        if axis[k] > 0:
            axis = A[:, k] / axis[k]
        n = np.linalg.norm(axis)
        axis = axis / n if n > 0 else np.array([1.0, 0.0, 0.0])
        if np.dot(vee(R - R.T), axis) < 0:
            axis = -axis
        return axis * t
    return vee(R - R.T) * (t / (2.0 * np.sin(t)))


def right_jacobian(phi):
    """Jr(phi): relates a perturbation of phi to a right perturbation of Exp(phi).

        Exp(phi + d) ~= Exp(phi) Exp(Jr(phi) d)

    This is what makes preintegration's bias correction a first-order update
    rather than a re-integration, so it has to be right.
    """
    t = float(np.linalg.norm(phi))
    K = hat(phi)
    return (np.eye(3)
            - _one_minus_cos_over_t2(t) * K
            + _t_minus_sin_over_t3(t) * (K @ K))


def right_jacobian_inv(phi):
    t = float(np.linalg.norm(phi))
    K = hat(phi)
    if t < 1e-3:
        t2 = t * t
        c = 1.0 / 12.0 + t2 / 720.0 + t2 * t2 / 30240.0
    else:
        c = 1.0 / (t * t) - (1.0 + np.cos(t)) / (2.0 * t * np.sin(t))
    return np.eye(3) + 0.5 * K + c * (K @ K)


def normalise(R):
    """Project back onto SO(3) via SVD.

    Floating point drags a rotation off the manifold over thousands of
    updates. Re-orthonormalising costs almost nothing and removes a slow
    failure mode that is very hard to distinguish from a modelling error.
    """
    U, _, Vt = np.linalg.svd(R)
    out = U @ Vt
    if np.linalg.det(out) < 0:
        U[:, -1] *= -1.0
        out = U @ Vt
    return out
