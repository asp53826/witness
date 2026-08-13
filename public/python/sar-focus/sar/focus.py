"""Image formation.

Backprojection is the honest algorithm. For every pixel and every pulse it
computes the exact two-way delay, samples the range-compressed history there,
and undoes the carrier phase before summing. It makes no assumption about the
track being straight, the scene being flat, or range migration being separable
from azimuth — which is why it is the reference the frequency-domain methods
get checked against, and why it costs O(pulses * pixels).

The phase conjugation is the whole algorithm in one line. The echo carried
exp(-j*4*pi*R/lambda); multiplying by exp(+j*4*pi*R/lambda) for the hypothesised
pixel range makes every pulse's contribution add in phase if and only if a
scatterer is actually there. Everywhere else the sum is incoherent and
averages down.
"""

import numpy as np

from .waveform import C


class Grid:
    """A rectangular ground-plane image grid."""

    def __init__(self, x_extent, y_extent, spacing):
        self.x = np.arange(-x_extent / 2.0, x_extent / 2.0 + 1e-9, spacing)
        self.y = np.arange(-y_extent / 2.0, y_extent / 2.0 + 1e-9, spacing)
        self.spacing = spacing

    @property
    def shape(self):
        return (len(self.y), len(self.x))

    def points(self):
        X, Y = np.meshgrid(self.x, self.y)
        return np.column_stack([X.ravel(), Y.ravel(), np.zeros(X.size)])

    def extent(self):
        return [self.x[0], self.x[-1], self.y[0], self.y[-1]]


def oversample_range(compressed, factor):
    """Band-limited interpolation along fast time.

    Backprojection has to sample the compressed history at arbitrary,
    non-integer delays. Doing that with linear interpolation on
    critically-sampled data is not a small error: the triangular interpolation
    kernel is a sinc-squared taper in the frequency domain, so it rolls off
    the band edges. That *is* an amplitude weighting, applied by accident.

    Measured on a point target it broadened the IRW by ~1-2% and pushed PSLR
    to -16.2 dB, comfortably below the -13.26 dB an unweighted aperture can
    physically achieve -- sidelobes that look better than theory are the
    giveaway that something is filtering the data. Oversampling first puts the
    interpolation error far below the sidelobe floor.
    """
    if factor <= 1:
        return compressed
    n = compressed.shape[-1]
    F = np.fft.fftshift(np.fft.fft(compressed, axis=-1), axes=-1)
    pad = n * (factor - 1) // 2
    F = np.pad(F, ((0, 0), (pad, pad)))
    return np.fft.ifft(np.fft.ifftshift(F, axes=-1), axis=-1) * factor


def backproject(collection, compressed, grid, phase_correction=None,
                oversample=8):
    """Time-domain backprojection.

    `compressed` is range-compressed phase history, (n_pulses, n_samples).
    Returns a complex image of grid.shape.
    """
    chirp = collection.chirp
    t0 = collection.gate_start()
    compressed = oversample_range(compressed, oversample)
    n_pulses, n_samples = compressed.shape
    fs = chirp.fs * oversample
    pts = grid.points()

    image = np.zeros(len(pts), dtype=complex)
    sample_index = np.arange(n_samples)

    for i in range(n_pulses):
        R = np.linalg.norm(collection.positions[i] - pts, axis=1)
        idx = (2.0 * R / C - t0) * fs

        # Linear interpolation in the compressed data. The data is complex and
        # oscillatory at the carrier, so interpolating it directly would be
        # wrong -- but after range compression the carrier has been demodulated
        # out and what remains is a smooth sinc envelope, which interpolates
        # fine. The phase is restored analytically on the next line.
        real = np.interp(idx, sample_index, compressed[i].real,
                         left=0.0, right=0.0)
        imag = np.interp(idx, sample_index, compressed[i].imag,
                         left=0.0, right=0.0)
        sample = real + 1j * imag

        phase = np.exp(4j * np.pi * R / chirp.wavelength)
        if phase_correction is not None:
            phase = phase * np.exp(-1j * phase_correction[i])
        image += sample * phase

    return image.reshape(grid.shape)
