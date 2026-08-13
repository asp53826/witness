"""Trajectory error metrics.

Two numbers, because they answer different questions and a system can be good
at one while being useless at the other:

  ATE   absolute trajectory error, after aligning the estimate to truth. Says
        how good the global shape is. Sensitive to slow drift.
  RPE   relative pose error over a fixed interval. Says how good the local
        motion is, and is blind to accumulated drift by construction.

A pure odometry system with no loop closure -- which is what this is -- should
have small RPE and an ATE that grows with distance travelled. Reporting only
ATE makes it look worse than it is; reporting only RPE hides the drift
entirely.
"""

import numpy as np

from .lie import log_so3


def umeyama(source, target, with_scale=False):
    """Rigid (or similarity) alignment of two point sets, closed form.

    Alignment is not cosmetic. VIO is unobservable in global position and yaw,
    so an estimate that is a rigid transform away from truth is exactly as
    correct as one that isn't -- comparing without aligning measures the
    arbitrary choice of origin.
    """
    source = np.asarray(source, dtype=float)
    target = np.asarray(target, dtype=float)
    mu_s, mu_t = source.mean(axis=0), target.mean(axis=0)
    S = (target - mu_t).T @ (source - mu_s) / len(source)
    U, d, Vt = np.linalg.svd(S)
    D = np.eye(3)
    if np.linalg.det(U) * np.linalg.det(Vt) < 0:
        D[-1, -1] = -1.0
    R = U @ D @ Vt
    if with_scale:
        var = ((source - mu_s) ** 2).sum() / len(source)
        s = float(np.trace(np.diag(d) @ D) / var) if var > 0 else 1.0
    else:
        s = 1.0
    t = mu_t - s * R @ mu_s
    return R, t, s


def ate(estimated, truth, align=True, with_scale=False):
    """Absolute trajectory error: RMSE of position after alignment."""
    est = np.asarray(estimated, dtype=float)
    tru = np.asarray(truth, dtype=float)
    if align:
        R, t, s = umeyama(est, tru, with_scale)
        est = (s * (R @ est.T).T) + t
    err = np.linalg.norm(est - tru, axis=1)
    return {"rmse": float(np.sqrt((err ** 2).mean())),
            "mean": float(err.mean()), "max": float(err.max()),
            "final": float(err[-1])}


def rpe(est_R, est_p, true_R, true_p, delta=20):
    """Relative pose error over `delta` frames.

    Measures the drift accumulated in a fixed window rather than since the
    start, so it isolates local accuracy from long-run drift.
    """
    trans, rot = [], []
    n = len(est_p)
    for i in range(0, n - delta):
        j = i + delta
        d_est = np.asarray(est_R[i]).T @ (np.asarray(est_p[j]) - np.asarray(est_p[i]))
        d_tru = np.asarray(true_R[i]).T @ (np.asarray(true_p[j]) - np.asarray(true_p[i]))
        trans.append(np.linalg.norm(d_est - d_tru))
        dR = np.asarray(est_R[i]).T @ np.asarray(est_R[j])
        dT = np.asarray(true_R[i]).T @ np.asarray(true_R[j])
        rot.append(np.linalg.norm(log_so3(dR.T @ dT)))
    if not trans:
        return {"trans_rmse": float("nan"), "rot_rmse_deg": float("nan")}
    trans = np.array(trans)
    rot = np.array(rot)
    return {"trans_rmse": float(np.sqrt((trans ** 2).mean())),
            "rot_rmse_deg": float(np.degrees(np.sqrt((rot ** 2).mean())))}


def rotation_error_deg(est_R, true_R):
    errs = [np.linalg.norm(log_so3(np.asarray(a).T @ np.asarray(b)))
            for a, b in zip(est_R, true_R)]
    return float(np.degrees(np.sqrt(np.mean(np.square(errs)))))


def path_length(positions):
    p = np.asarray(positions, dtype=float)
    return float(np.linalg.norm(np.diff(p, axis=0), axis=1).sum())
