"""Impulse response analysis and image quality.

A SAR image is judged by what it does to a point scatterer. Three numbers,
each of which has an analytic value to check against, which is the reason this
repo can claim to be correct rather than merely to produce plausible pictures:

  IRW    -3 dB impulse response width. For an unweighted aperture this is
         0.886 times the nominal resolution, not the nominal resolution --
         c/2B is the Rayleigh figure, and confusing the two is an easy way to
         report an 11% error as a success.
  PSLR   peak sidelobe ratio, -13.26 dB unweighted, about -42.8 dB Hamming.
  ISLR   integrated sidelobe ratio -- energy outside the main lobe, which is
         what actually smears bright targets across dark scenes.

All three are measured on an interpolated cut, because at typical sampling a
main lobe is only a couple of samples wide and measuring its width from those
samples directly is meaningless.
"""

import numpy as np

DB3 = 10.0 ** (-3.0 / 20.0)


def upsample(x, factor=16):
    """Band-limited interpolation by zero-padding in the frequency domain.

    Valid because the data really is band-limited -- it came out of a matched
    filter. Linear interpolation would round off the peak and bias the width.
    """
    x = np.asarray(x)
    n = len(x)
    F = np.fft.fftshift(np.fft.fft(x))
    pad = n * (factor - 1) // 2
    return np.fft.ifft(np.fft.ifftshift(np.pad(F, (pad, pad)))) * factor


def irf(cut, spacing, factor=16):
    """Measure IRW, PSLR and ISLR from a 1-D cut through a point response.

    `spacing` is the sample spacing in metres; the returned width is in metres.
    """
    y = np.abs(upsample(cut, factor))
    y = y / y.max()
    fine = spacing / factor
    peak = int(np.argmax(y))

    irw = _minus_3db_width(y, peak) * fine
    nulls = _main_lobe(y, peak)
    if nulls is None:
        return {"irw": irw, "pslr": np.nan, "islr": np.nan}

    lo, hi = nulls
    side = np.concatenate([y[:lo], y[hi:]])
    pslr = 20.0 * np.log10(side.max()) if len(side) else np.nan

    p2 = y ** 2
    main_energy = p2[lo:hi].sum()
    side_energy = p2.sum() - main_energy
    islr = (10.0 * np.log10(side_energy / main_energy)
            if main_energy > 0 else np.nan)

    return {"irw": irw, "pslr": float(pslr), "islr": float(islr)}


def _minus_3db_width(y, peak):
    """Width in fine samples, found by walking out from the peak.

    Walking outward rather than thresholding the whole array matters: a second
    scatterer elsewhere in the cut can sit above -3 dB and would otherwise be
    swallowed into this target's main lobe.
    """
    left = peak
    while left > 0 and y[left] >= DB3:
        left -= 1
    right = peak
    while right < len(y) - 1 and y[right] >= DB3:
        right += 1
    # linear interpolation onto the crossing, so the answer isn't quantised
    # to the interpolation grid
    lo = _cross(y, left, left + 1)
    hi = _cross(y, right, right - 1)
    return abs(hi - lo)


def _cross(y, a, b):
    ya, yb = y[a], y[b]
    if ya == yb:
        return float(a)
    return a + (DB3 - ya) / (yb - ya) * (b - a)


def _main_lobe(y, peak):
    """First null either side of the peak."""
    left = peak
    while left > 0 and y[left - 1] < y[left]:
        left -= 1
    right = peak
    while right < len(y) - 1 and y[right + 1] < y[right]:
        right += 1
    if left == 0 or right == len(y) - 1:
        return None
    return left, right


def analyse_point(image, spacing, factor=16):
    """IRF in both image axes through the brightest pixel."""
    m = np.abs(image)
    r, c = np.unravel_index(np.argmax(m), m.shape)
    return {
        "peak_row": int(r), "peak_col": int(c),
        "range": irf(image[:, c], spacing, factor),
        "azimuth": irf(image[r, :], spacing, factor),
    }


def entropy(image):
    """Image entropy of the normalised intensity.

    The standard autofocus cost function. A focused image concentrates energy
    into few bright pixels, which is a low-entropy distribution; defocus
    spreads the same energy out and raises it. Minimising it is equivalent to
    maximising sharpness but better behaved numerically.
    """
    p = np.abs(image) ** 2
    total = p.sum()
    if total <= 0:
        return np.nan
    p = p / total
    nz = p[p > 0]
    return float(-(nz * np.log(nz)).sum())


def contrast(image):
    """std/mean of intensity. Rises as an image comes into focus."""
    p = np.abs(image) ** 2
    return float(p.std() / p.mean()) if p.mean() > 0 else np.nan


def peak_db(image):
    """Image in dB relative to its own peak, for display."""
    m = np.abs(image)
    return 20.0 * np.log10(np.maximum(m / m.max(), 1e-12))
