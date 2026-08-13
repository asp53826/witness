"""Phase gradient autofocus.

Image formation assumes you know where the antenna was to a small fraction of
a wavelength. At X-band that is a few millimetres, which no practical
navigation system delivers, so the residual shows up as a phase error across
the aperture and the image defocuses. Autofocus estimates that error from the
data itself.

PGA works because a bright isolated scatterer is a known signal: its response
*should* be a clean impulse, so any phase structure on it is the error. Doing
this on one scatterer is noisy; PGA does it on the brightest scatterer in every
range bin at once and averages, which is what makes it robust enough to be the
standard method rather than a trick.

The four steps, and why each is there:

  centre    circularly shift each range bin so its brightest scatterer sits at
            zero azimuth. This removes the linear phase that a scatterer's
            offset would otherwise contribute, which would be indistinguishable
            from a real error and would just translate the image.
  window    keep only the region the blur actually occupies. Everything outside
            is other scatterers and noise, and including it dilutes the
            estimate. The window shrinks each iteration as the image sharpens.
  estimate  the linear-unbiased minimum-variance phase-gradient estimator,
            averaged over range bins weighted by their energy.
  integrate cumulative-sum the gradient, then remove the linear trend, because
            a linear phase is a shift and not a defocus.
"""

import numpy as np

from .metrics import entropy


def _centre(img):
    """Shift each range bin so its peak is at the centre of the azimuth axis."""
    n_az = img.shape[1]
    out = np.empty_like(img)
    for r in range(img.shape[0]):
        peak = int(np.argmax(np.abs(img[r])))
        out[r] = np.roll(img[r], n_az // 2 - peak)
    return out


def _window_width(img, floor_db=-12.0, min_width=8):
    """Width of the blur, from the range-averaged azimuth power profile."""
    prof = (np.abs(img) ** 2).sum(axis=0)
    prof = prof / prof.max()
    keep = np.where(10.0 * np.log10(np.maximum(prof, 1e-20)) >= floor_db)[0]
    if len(keep) == 0:
        return min_width
    centre = len(prof) // 2
    half = max(np.abs(keep - centre).max(), min_width // 2)
    return int(min(2 * half, len(prof)))


def _phase_gradient(G):
    """LUMV estimator: Im{ sum_r conj(G) dG/dn } / sum_r |G|^2.

    The energy weighting in the denominator is what makes this minimum
    variance rather than just an average -- range bins with a strong scatterer
    say more about the phase error than empty ones, and this weights them
    accordingly without any thresholding.
    """
    dG = np.gradient(G, axis=1)
    num = np.imag(np.conj(G) * dG).sum(axis=0)
    den = (np.abs(G) ** 2).sum(axis=0)
    return num / np.maximum(den, 1e-30)


def _select_bins(img, keep):
    """Range bins whose azimuth cut has a strong, isolated peak.

    PGA's estimate is an average over range bins, and a bin containing no
    scatterer contributes only noise to that average. The energy weighting in
    the estimator helps but does not fix it, because a defocused bright target
    smears energy into neighbouring bins that then look energetic without
    carrying clean phase. Ranking by peak-to-mean and keeping the top slice is
    the standard remedy and measurably tightens the estimate.
    """
    p = np.abs(img)
    ratio = p.max(axis=1) / np.maximum(p.mean(axis=1), 1e-30)
    n = max(1, min(len(ratio), int(keep) if keep >= 1
                   else int(round(keep * len(ratio)))))
    return np.argsort(ratio)[-n:]


def pga(image, iterations=6, floor_db=-12.0, min_width=8, keep_bins=0.1,
        track=False):
    """Estimate and remove an azimuth phase error from a complex image.

    Returns (focused_image, estimated_phase), and optionally a per-iteration
    history of entropy and window width.
    """
    img = np.asarray(image, dtype=complex)
    n_az = img.shape[1]
    total = np.zeros(n_az)
    history = []
    cost = entropy(img)
    # Best-so-far, not last. PGA's cost does not fall monotonically: an early
    # iteration with a wide window can raise entropy before the window
    # narrows and it drops sharply. Stopping at the first non-improving step
    # therefore gives up too early on a genuinely defocused image, while
    # returning the last step degrades an already-focused one. Keeping the
    # best makes both cases behave, and makes running it on clean data a
    # no-op rather than a hazard.
    best_cost, best_img, best_phase = cost, img, total.copy()

    for _ in range(iterations):
        rows = _select_bins(img, keep_bins)
        centred = _centre(img[rows])

        width = _window_width(centred, floor_db, min_width)
        mask = np.zeros(n_az)
        lo = n_az // 2 - width // 2
        mask[lo:lo + width] = np.hanning(width)
        windowed = centred * mask[None, :]

        G = np.fft.fft(windowed, axis=1)
        grad = _phase_gradient(G)

        phase = np.cumsum(grad)
        # strip piston and linear terms: neither defocuses, and leaving the
        # linear term in makes the image walk sideways every iteration
        n = np.arange(n_az)
        coeffs = np.polyfit(n, phase, 1)
        phase = phase - np.polyval(coeffs, n)

        # Add, don't subtract. The LUMV estimator built from np.gradient over
        # a forward FFT returns the conjugate of the error, so the correction
        # that removes it is exp(+j*phase). Verified by the sign of the change
        # in image entropy: with exp(-j*phase) every iteration made the image
        # measurably worse (9.230 -> 9.364) instead of better.
        F = np.fft.fft(img, axis=1) * np.exp(1j * phase)[None, :]
        candidate = np.fft.ifft(F, axis=1)

        # Iterate freely, but only *return* a step that beat the starting
        # cost. Left ungated, PGA degrades an image that is already focused:
        # with few bright scatterers most range bins hold sidelobe ridges
        # rather than targets and the estimator fits those. Measured on clean
        # data, six ungated iterations raised entropy 7.83 -> 8.55 and drove
        # the apparent IRW *below* the diffraction limit, which is not
        # resolution, it is artifact.
        img = candidate
        total = total + phase
        cost = entropy(img)

        if np.isfinite(cost) and cost < best_cost:
            best_cost, best_img, best_phase = cost, img, total.copy()

        if track:
            history.append({"entropy": cost, "width": int(width),
                            "phase_rms": float(np.std(phase))})

    return ((best_img, best_phase, history) if track
            else (best_img, best_phase))
