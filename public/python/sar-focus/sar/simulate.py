"""Raw phase-history generation.

The simulator is the ground truth for everything else in this repo, so it is
written to be obviously correct rather than fast: for every pulse, for every
scatterer, evaluate the exact two-way delay and lay down the chirp. No
approximations, no linearised range history, no separable assumption. Range
cell migration therefore appears because the geometry produces it, not because
it was inserted.

This is also the honest limitation of the project. Simulated data means the
image formation is being checked against physics I also wrote. It pins down
resolution, sidelobes and autofocus behaviour, which are the things that have
analytic answers; it says nothing about real-world calibration, motion
measurement error, or clutter statistics.
"""

import numpy as np

from .waveform import C


def raw_data(collection, scene, amplitudes=None, n_samples=None, noise=0.0,
             seed=0):
    """Generate the (n_pulses, n_samples) complex phase history.

    `scene` is (M, 3) scatterer positions; `amplitudes` their complex
    reflectivity.
    """
    chirp = collection.chirp
    scene = np.atleast_2d(scene)
    if amplitudes is None:
        amplitudes = np.ones(len(scene), dtype=complex)
    amplitudes = np.asarray(amplitudes, dtype=complex)

    if n_samples is None:
        n_samples = _default_samples(collection, scene)

    tau = collection.fast_time(n_samples)
    ranges = collection.ranges(scene)                 # (n_pulses, M)
    out = np.zeros((collection.n_pulses, n_samples), dtype=complex)

    for i in range(collection.n_pulses):
        for j, amp in enumerate(amplitudes):
            out[i] += chirp.echo(tau, 2.0 * ranges[i, j] / C, amp)

    if noise > 0.0:
        rng = np.random.default_rng(seed)
        out += noise * (rng.normal(size=out.shape)
                        + 1j * rng.normal(size=out.shape)) / np.sqrt(2.0)
    return out


def _default_samples(collection, scene):
    """Enough fast time to hold the pulse plus the full range migration.

    Sizing this from the actual range spread rather than a fixed constant is
    what stops a wide scene from having its far edge silently gated out --
    which shows up as targets that simply vanish from the image with no error.
    """
    r = collection.ranges(scene)
    spread = 2.0 * (r.max() - r.min()) / C
    span = collection.chirp.Tp + spread + 3e-6
    return int(2 ** np.ceil(np.log2(span * collection.chirp.fs)))


def quadratic_phase_error(n_pulses, radians_peak):
    """A defocusing phase ramp across the aperture.

    Quadratic error is the canonical defocus: it comes from an error in the
    assumed range to scene centre, or equivalently from uncompensated
    along-track acceleration, and it broadens the azimuth response
    symmetrically. Used to give autofocus something real to remove.
    """
    u = np.linspace(-1.0, 1.0, n_pulses)
    return radians_peak * u ** 2


def random_phase_error(n_pulses, rms_radians, correlation=8, seed=0):
    """Smoothly-varying random phase, the more realistic case.

    White phase noise is not what an uncompensated platform produces; real
    motion error is correlated over many pulses, which is why it defocuses
    rather than just raising the noise floor.
    """
    rng = np.random.default_rng(seed)
    raw = rng.normal(size=n_pulses)
    kernel = np.hanning(max(3, 2 * correlation + 1))
    kernel /= kernel.sum()
    smooth = np.convolve(raw, kernel, mode="same")
    smooth -= smooth.mean()
    if smooth.std() > 0:
        smooth *= rms_radians / smooth.std()
    return smooth


def apply_phase_error(data, phase):
    """Impose a per-pulse phase error on a phase history."""
    return data * np.exp(1j * np.asarray(phase))[:, None]
