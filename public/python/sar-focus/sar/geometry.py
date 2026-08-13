"""Collection geometry.

Kept deliberately general: a platform is an (N, 3) array of positions, a scene
is an (M, 3) array of scatterers, and range is just a Euclidean norm. Nothing
downstream assumes a straight track or a flat earth, which is what makes the
backprojector in `focus.py` exact rather than an approximation that happens to
work for the geometry it was written against.

The closed-form helpers below build the standard straight-line stripmap case,
because that is the one with analytic resolution formulas to check against.
"""

import numpy as np

from .waveform import C


class Collection:
    """A platform track plus the waveform it was collecting with."""

    def __init__(self, positions, chirp, prf, swath_centre):
        self.positions = np.asarray(positions, dtype=float)
        if self.positions.ndim != 2 or self.positions.shape[1] != 3:
            raise ValueError("positions must be (N, 3)")
        self.chirp = chirp
        self.prf = prf
        self.swath_centre = np.asarray(swath_centre, dtype=float)

    @property
    def n_pulses(self):
        return len(self.positions)

    @property
    def aperture_length(self):
        """Straight-line distance flown, i.e. the synthetic aperture."""
        return float(np.linalg.norm(self.positions[-1] - self.positions[0]))

    @property
    def reference_range(self):
        return float(np.linalg.norm(self.positions[self.n_pulses // 2]
                                    - self.swath_centre))

    def ranges(self, points):
        """(n_pulses, n_points) of platform-to-point distance."""
        points = np.atleast_2d(points)
        return np.linalg.norm(self.positions[:, None, :] - points[None, :, :],
                              axis=2)

    # -- fast-time axis ----------------------------------------------------

    def gate_start(self, margin=1.5e-6):
        """When the receive window opens, referenced to swath centre.

        Opening it half a pulse plus a margin early means the full compressed
        response of a scatterer at swath centre is inside the window, which
        matters because a partially-gated chirp compresses into something that
        is not a sinc and quietly ruins the sidelobe measurements.
        """
        return 2.0 * self.reference_range / C - self.chirp.Tp / 2.0 - margin

    def fast_time(self, n_samples):
        return self.gate_start() + np.arange(n_samples) / self.chirp.fs

    def range_axis(self, n_samples):
        return self.fast_time(n_samples) * C / 2.0

    # -- theoretical resolutions ------------------------------------------

    @property
    def azimuth_resolution(self):
        """lambda * R / (2 * L_sa) -- the standard synthetic-aperture result.

        A longer aperture means a larger angular diversity on the target,
        which is the only thing that buys cross-range resolution. Note this is
        the nominal figure; the measured -3 dB width of an unweighted response
        is 0.886 times it, and the tests check against that.
        """
        return (self.chirp.wavelength * self.reference_range
                / (2.0 * self.aperture_length))


def stripmap(chirp, velocity=200.0, altitude=3000.0, ground_range=4000.0,
             aperture=300.0, prf=1000.0):
    """A straight, level pass broadside to a scene centred at the origin."""
    duration = aperture / velocity
    n = int(round(duration * prf))
    x = (np.arange(n) - n / 2.0) * velocity / prf
    positions = np.column_stack([x, np.full(n, -ground_range),
                                 np.full(n, altitude)])
    return Collection(positions, chirp, prf, np.zeros(3))


def point_targets(offsets):
    """Scene of unit scatterers at (x, y) ground offsets from scene centre."""
    offsets = np.atleast_2d(offsets)
    return np.column_stack([offsets[:, 0], offsets[:, 1],
                            np.zeros(len(offsets))])
