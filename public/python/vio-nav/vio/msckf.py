"""Multi-State Constraint Kalman Filter.

The idea that makes MSCKF work: never put landmarks in the state vector.

A SLAM filter carries every mapped point as state, so its covariance grows
quadratically in landmark count and an EKF update costs cubically. MSCKF keeps
a sliding window of *past camera poses* instead. When a feature is finally
lost, it is triangulated from all the views that saw it, and the resulting
residual constrains those poses relative to each other. The feature's own error
is then removed algebraically -- project the residual onto the left null space
of the feature Jacobian -- so it never enters the filter at all.

Cost becomes linear in features and cubic only in window size, which is a
constant you choose. That is the entire trade, and it is why MSCKF runs on
hardware that could not carry a map.

Error state, 15 + 6N:
    [dtheta, dv, dp, dbg, dba] then [dtheta_i, dp_i] per cloned pose.
"""

import numpy as np

from .camera import triangulate
from .imu import GRAVITY, ImuNoise
from .lie import exp_so3, hat, normalise


class Clone:
    __slots__ = ("R", "p", "t")

    def __init__(self, R, p, t):
        self.R, self.p, self.t = R, p, t


class MSCKF:
    def __init__(self, camera, noise=None, window=12, chi2_factor=3.0,
                 min_track=3, min_parallax=0.05):
        self.camera = camera
        self.noise = noise or ImuNoise()
        self.window = window
        self.chi2_factor = chi2_factor
        self.min_track = min_track
        self.min_parallax = min_parallax

        self.R = np.eye(3)
        self.v = np.zeros(3)
        self.p = np.zeros(3)
        self.bg = np.zeros(3)
        self.ba = np.zeros(3)

        self.P = np.eye(15) * 1e-4
        self.P[9:12, 9:12] = np.eye(3) * 1e-4      # gyro bias
        self.P[12:15, 12:15] = np.eye(3) * 1e-2    # accel bias

        self.clones = []
        self.tracks = {}          # landmark id -> list of (clone index, uv)
        self.stats = {"updates": 0, "features_used": 0, "rejected_chi2": 0,
                      "rejected_triangulation": 0, "rejected_parallax": 0}

    # -- initialisation ----------------------------------------------------

    def initialise(self, R, v, p, bg=None, ba=None):
        self.R = normalise(np.asarray(R, dtype=float).copy())
        self.v = np.asarray(v, dtype=float).copy()
        self.p = np.asarray(p, dtype=float).copy()
        if bg is not None:
            self.bg = np.asarray(bg, dtype=float).copy()
        if ba is not None:
            self.ba = np.asarray(ba, dtype=float).copy()

    # -- propagation -------------------------------------------------------

    def propagate(self, gyro, accel, dt):
        """One IMU step: state forward, covariance forward."""
        w = np.asarray(gyro) - self.bg
        a = np.asarray(accel) - self.ba
        a_world = self.R @ a + GRAVITY

        F = np.eye(15)
        F[0:3, 0:3] = exp_so3(w * dt).T
        F[0:3, 9:12] = -np.eye(3) * dt
        F[3:6, 0:3] = -self.R @ hat(a) * dt
        F[3:6, 12:15] = -self.R * dt
        F[6:9, 3:6] = np.eye(3) * dt

        G = np.zeros((15, 12))
        G[0:3, 0:3] = -np.eye(3) * dt
        G[3:6, 3:6] = -self.R * dt
        G[9:12, 6:9] = np.eye(3) * dt
        G[12:15, 9:12] = np.eye(3) * dt

        n = self.noise
        Q = np.diag(np.concatenate([
            np.full(3, n.gyro ** 2 / dt), np.full(3, n.accel ** 2 / dt),
            np.full(3, n.gyro_walk ** 2 * dt), np.full(3, n.accel_walk ** 2 * dt)]))

        nc = 15 + 6 * len(self.clones)
        Phi = np.eye(nc)
        Phi[:15, :15] = F
        self.P = Phi @ self.P @ Phi.T
        self.P[:15, :15] += G @ Q @ G.T
        self.P = 0.5 * (self.P + self.P.T)

        # state last, so the Jacobians above used the pre-update rotation
        self.p = self.p + self.v * dt + 0.5 * a_world * dt * dt
        self.v = self.v + a_world * dt
        self.R = normalise(self.R @ exp_so3(w * dt))

    # -- cloning -----------------------------------------------------------

    def augment(self, t):
        """Clone the current camera pose into the sliding window."""
        R_wc, p_wc = self.camera.world_to_camera(self.R, self.p)
        self.clones.append(Clone(R_wc, p_wc, t))

        n = 15 + 6 * (len(self.clones) - 1)
        J = np.zeros((6, n))
        J[0:3, 0:3] = self.camera.R_bc.T
        J[3:6, 0:3] = -self.R @ hat(self.camera.p_bc)
        J[3:6, 6:9] = np.eye(3)

        P = self.P
        top = np.hstack([P, (J @ P).T])
        bottom = np.hstack([J @ P, J @ P @ J.T])
        self.P = np.vstack([top, bottom])
        self.P = 0.5 * (self.P + self.P.T)

    def _drop_clone(self, i):
        keep = [k for k in range(len(self.clones)) if k != i]
        idx = list(range(15))
        for k in keep:
            idx += list(range(15 + 6 * k, 21 + 6 * k))
        self.P = self.P[np.ix_(idx, idx)]
        self.clones.pop(i)
        remapped = {}
        for f, obs in self.tracks.items():
            new = [(k - (1 if k > i else 0), uv) for k, uv in obs if k != i]
            if new:
                remapped[f] = new
        self.tracks = remapped

    # -- measurement -------------------------------------------------------

    def add_observations(self, observations):
        """Attach this frame's features to the newest clone."""
        i = len(self.clones) - 1
        seen = set()
        for fid, uv in observations.items():
            self.tracks.setdefault(fid, []).append((i, uv))
            seen.add(fid)
        return seen

    def _feature_jacobians(self, obs, point):
        """Residual and Jacobians for one feature across its observations.

        Returns (r, H_x, H_f): residual, Jacobian w.r.t. the cloned poses, and
        w.r.t. the feature position.
        """
        rows = 2 * len(obs)
        H_x = np.zeros((rows, 15 + 6 * len(self.clones)))
        H_f = np.zeros((rows, 3))
        r = np.zeros(rows)

        for k, (ci, uv) in enumerate(obs):
            c = self.clones[ci]
            pc = c.R.T @ (point - c.p)
            if pc[2] <= 1e-6:
                return None
            J = self.camera.jacobian_normalised(pc)
            r[2 * k:2 * k + 2] = self.camera.normalise(uv) - pc[:2] / pc[2]

            col = 15 + 6 * ci
            H_x[2 * k:2 * k + 2, col:col + 3] = J @ hat(pc)
            H_x[2 * k:2 * k + 2, col + 3:col + 6] = -J @ c.R.T
            H_f[2 * k:2 * k + 2, :] = J @ c.R.T

        return r, H_x, H_f

    @staticmethod
    def _null_project(r, H_x, H_f):
        """Remove the feature's error from the residual.

        The feature position is unknown and not in the state. Left-multiplying
        by a basis for the left null space of H_f kills the H_f term exactly,
        leaving a constraint purely between camera poses. This is the step the
        whole filter is named after -- it is not an approximation, it is an
        algebraic elimination.
        """
        U, s, _ = np.linalg.svd(H_f, full_matrices=True)
        rank = int((s > 1e-9).sum())
        A = U[:, rank:]
        if A.shape[1] == 0:
            return None
        return A.T @ r, A.T @ H_x

    def _parallax(self, obs):
        """Angular spread of the views. Too little and triangulation is a
        guess dressed up with a covariance."""
        if len(obs) < 2:
            return 0.0
        pts = np.array([self.clones[i].p for i, _ in obs])
        return float(np.linalg.norm(pts.max(axis=0) - pts.min(axis=0)))

    def update(self, mature):
        """EKF update from a set of finished feature tracks."""
        R_stack, H_stack = [], []

        for fid in mature:
            obs = self.tracks.get(fid, [])
            if len(obs) < self.min_track:
                continue
            if self._parallax(obs) < self.min_parallax:
                self.stats["rejected_parallax"] += 1
                continue

            views = [(uv, self.clones[i].R, self.clones[i].p) for i, uv in obs]
            point = triangulate(views, self.camera)
            if point is None:
                self.stats["rejected_triangulation"] += 1
                continue

            got = self._feature_jacobians(obs, point)
            if got is None:
                self.stats["rejected_triangulation"] += 1
                continue
            r, H_x, H_f = got

            proj = self._null_project(r, H_x, H_f)
            if proj is None:
                continue
            r_o, H_o = proj

            # gating on the projected residual, in its own covariance
            sigma = (self.camera.sigma_px / self.camera.fx) ** 2
            S = H_o @ self.P @ H_o.T + np.eye(len(r_o)) * sigma
            try:
                d2 = float(r_o @ np.linalg.solve(S, r_o))
            except np.linalg.LinAlgError:
                continue
            if d2 > self.chi2_factor * len(r_o):
                self.stats["rejected_chi2"] += 1
                continue

            R_stack.append(r_o)
            H_stack.append(H_o)
            self.stats["features_used"] += 1

        if not R_stack:
            return False

        r = np.concatenate(R_stack)
        H = np.vstack(H_stack)

        # QR compression: with many features H is very tall and thin, and the
        # update only needs its row space. Skipping this makes the Kalman gain
        # a solve of size (2 * total observations), which dominates everything.
        if H.shape[0] > H.shape[1]:
            Q, Rr = np.linalg.qr(H)
            H = Rr
            r = Q.T @ r

        sigma = (self.camera.sigma_px / self.camera.fx) ** 2
        S = H @ self.P @ H.T + np.eye(H.shape[0]) * sigma
        K = np.linalg.solve(S, H @ self.P).T
        dx = K @ r

        self._apply(dx)
        I_KH = np.eye(self.P.shape[0]) - K @ H
        self.P = I_KH @ self.P @ I_KH.T + K @ (np.eye(H.shape[0]) * sigma) @ K.T
        self.P = 0.5 * (self.P + self.P.T)
        self.stats["updates"] += 1
        return True

    def _apply(self, dx):
        self.R = normalise(self.R @ exp_so3(dx[0:3]))
        self.v = self.v + dx[3:6]
        self.p = self.p + dx[6:9]
        self.bg = self.bg + dx[9:12]
        self.ba = self.ba + dx[12:15]
        for i, c in enumerate(self.clones):
            o = 15 + 6 * i
            c.R = normalise(c.R @ exp_so3(dx[o:o + 3]))
            c.p = c.p + dx[o + 3:o + 6]

    # -- driver ------------------------------------------------------------

    def process_frame(self, t, observations):
        """Clone, attach observations, update on lost tracks, trim the window."""
        self.augment(t)
        seen = self.add_observations(observations)

        mature = [f for f in list(self.tracks) if f not in seen]
        if mature:
            self.update(mature)
            for f in mature:
                self.tracks.pop(f, None)

        while len(self.clones) > self.window:
            # marginalise the oldest pose; anything still tracked on it gets
            # one last chance to contribute before the pose disappears
            still = [f for f, o in self.tracks.items() if any(i == 0 for i, _ in o)]
            if still:
                self.update(still)
            self._drop_clone(0)

    @property
    def state(self):
        return self.R.copy(), self.v.copy(), self.p.copy()
