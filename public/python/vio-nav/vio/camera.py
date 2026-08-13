"""Pinhole camera and feature triangulation.

The camera contributes no absolute information at all -- it measures bearing,
not range, so a single view of a point says only "somewhere along this ray".
Structure comes from parallax between views, which is why a VIO that hovers
in place has nothing to correct its inertial drift with, and why the benchmark
uses trajectories that actually move.
"""

import numpy as np


class Camera:
    """Pinhole intrinsics plus a fixed body-to-camera extrinsic."""

    def __init__(self, fx=458.0, fy=457.0, cx=367.0, cy=248.0,
                 width=752, height=480, R_bc=None, p_bc=None, sigma_px=1.0):
        self.fx, self.fy, self.cx, self.cy = fx, fy, cx, cy
        self.width, self.height = width, height
        # default: camera looks along +x of the body, z_cam forward
        self.R_bc = (np.array([[0.0, 0.0, 1.0],
                               [-1.0, 0.0, 0.0],
                               [0.0, -1.0, 0.0]]) if R_bc is None
                     else np.asarray(R_bc, dtype=float))
        self.p_bc = np.zeros(3) if p_bc is None else np.asarray(p_bc, float)
        self.sigma_px = sigma_px

    def world_to_camera(self, R_wb, p_wb):
        """Body pose in world -> camera rotation and origin in world."""
        R_wc = R_wb @ self.R_bc
        p_wc = p_wb + R_wb @ self.p_bc
        return R_wc, p_wc

    def project(self, point_cam):
        """Camera-frame 3D point -> pixels. Returns None behind the camera."""
        z = point_cam[2]
        if z <= 1e-6:
            return None
        u = self.fx * point_cam[0] / z + self.cx
        v = self.fy * point_cam[1] / z + self.cy
        return np.array([u, v])

    def in_view(self, uv):
        return (uv is not None and 0.0 <= uv[0] < self.width
                and 0.0 <= uv[1] < self.height)

    def observe(self, point_world, R_wc, p_wc):
        """Project a world point through a camera pose. None if not visible."""
        pc = R_wc.T @ (np.asarray(point_world) - p_wc)
        uv = self.project(pc)
        return uv if self.in_view(uv) else None

    def normalise(self, uv):
        """Pixels to normalised image coordinates."""
        return np.array([(uv[0] - self.cx) / self.fx,
                         (uv[1] - self.cy) / self.fy])

    def jacobian_normalised(self, pc):
        """d(normalised projection)/d(camera-frame point)."""
        x, y, z = pc
        iz = 1.0 / z
        return np.array([[iz, 0.0, -x * iz * iz],
                         [0.0, iz, -y * iz * iz]])


def triangulate(observations, camera, iterations=8):
    """Least-squares 3D point from several bearing observations.

    `observations` is a list of (uv, R_wc, p_wc).

    Linear DLT for an initial guess, then Gauss-Newton on the reprojection
    error using an inverse-depth parameterisation. The inverse-depth step is
    what makes distant points behave: parameterised directly in XYZ, a point
    near infinity has an effectively unbounded coordinate and the normal
    equations go singular, so the filter either rejects good features or
    accepts a wild estimate.
    """
    if len(observations) < 2:
        return None

    A = []
    for uv, R_wc, p_wc in observations:
        xn = camera.normalise(uv)
        ray = R_wc @ np.array([xn[0], xn[1], 1.0])
        # each view says the point lies on a line; stack the orthogonal
        # complement constraints
        P = np.eye(3) - np.outer(ray, ray) / np.dot(ray, ray)
        A.append((P, P @ p_wc))

    H = sum(P for P, _ in A)
    b = sum(rhs for _, rhs in A)
    try:
        guess = np.linalg.solve(H, b)
    except np.linalg.LinAlgError:
        return None

    # Gauss-Newton refinement in the first camera's inverse-depth frame
    uv0, R0, p0 = observations[0]
    rel = R0.T @ (guess - p0)
    if rel[2] <= 1e-6:
        return None
    state = np.array([rel[0] / rel[2], rel[1] / rel[2], 1.0 / rel[2]])

    for _ in range(iterations):
        JtJ = np.zeros((3, 3))
        Jtr = np.zeros(3)
        cost = 0.0
        alpha, beta, rho = state
        for uv, R_wc, p_wc in observations:
            # point in this camera, up to positive scale
            R_rel = R_wc.T @ R0
            t_rel = R_wc.T @ (p0 - p_wc)
            h = R_rel @ np.array([alpha, beta, 1.0]) + rho * t_rel
            if h[2] <= 1e-8:
                return None
            pred = np.array([h[0] / h[2], h[1] / h[2]])
            r = camera.normalise(uv) - pred
            dh = np.column_stack([R_rel[:, 0], R_rel[:, 1], t_rel])
            J = -camera.jacobian_normalised(h) @ dh
            JtJ += J.T @ J
            Jtr += J.T @ r
            cost += r @ r
        try:
            step = np.linalg.solve(JtJ + 1e-9 * np.eye(3), -Jtr)
        except np.linalg.LinAlgError:
            return None
        state = state + step
        if np.linalg.norm(step) < 1e-10:
            break

    alpha, beta, rho = state
    if rho <= 1e-8:
        return None                      # point at or behind infinity
    return p0 + R0 @ (np.array([alpha, beta, 1.0]) / rho)
