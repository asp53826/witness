"""Linear FM waveform and range compression.

SAR gets its range resolution from bandwidth, not from pulse length. A pulse
short enough to resolve a metre directly would carry almost no energy, so
instead you transmit a long pulse that sweeps in frequency and compress it on
receive. The compressed width is 1/B regardless of how long the pulse was.

Everything here is at baseband: the carrier is demodulated out and survives
only as the phase term exp(-j*4*pi*R/lambda), which is the term the whole
azimuth story depends on.
"""

import numpy as np

C = 299_792_458.0


class Chirp:
    """A linear-FM pulse, and the matched filter for it.

    fc  carrier, Hz          B   swept bandwidth, Hz
    Tp  pulse duration, s    fs  complex sample rate, Hz
    """

    def __init__(self, fc=10e9, B=200e6, Tp=10e-6, fs=None, window=None):
        self.fc = fc
        self.B = B
        self.Tp = Tp
        self.fs = fs if fs is not None else 1.2 * B
        self.window = window
        if self.fs < B:
            raise ValueError(f"fs={self.fs:g} under-samples B={B:g}")

    @property
    def wavelength(self):
        return C / self.fc

    @property
    def chirp_rate(self):
        """Kr, Hz/s. Positive is an up-chirp."""
        return self.B / self.Tp

    @property
    def range_resolution(self):
        """The theoretical number every measurement in this repo is checked
        against: c / 2B. The factor of two is the two-way path."""
        return C / (2.0 * self.B)

    def support(self):
        """Fast-time samples spanning the pulse, centred on zero."""
        n = int(round(self.Tp * self.fs))
        return (np.arange(n) - n // 2) / self.fs

    def transmit(self, t=None):
        """s(t) = exp(j*pi*Kr*t^2) over |t| <= Tp/2."""
        t = self.support() if t is None else np.asarray(t)
        return np.exp(1j * np.pi * self.chirp_rate * t ** 2)

    def echo(self, tau, delay, amplitude=1.0):
        """One scatterer's return at two-way `delay` seconds.

        The second exponential is the carrier phase. It is the entire reason
        SAR works: a fraction of a wavelength of platform motion changes it
        measurably, which is what synthesises the aperture.
        """
        t = np.asarray(tau) - delay
        gate = np.abs(t) <= self.Tp / 2.0
        phase = np.pi * self.chirp_rate * t ** 2 - 2.0 * np.pi * self.fc * delay
        return amplitude * gate * np.exp(1j * phase)

    def matched_filter(self, n):
        """Frequency-domain matched filter, length n.

        Built by transforming the time-reversed conjugate reference rather
        than writing the analytic spectrum, so any windowing or sampling
        choice above is automatically consistent with it.
        """
        ref = self.transmit()
        if self.window is not None:
            ref = ref * get_window(self.window, len(ref))
        padded = np.zeros(n, dtype=complex)
        padded[:len(ref)] = ref
        return np.conj(np.fft.fft(padded))

    def compress(self, raw, axis=-1):
        """Pulse-compress along the fast-time axis.

        Returns data whose peak sits at the sample corresponding to the
        scatterer's delay, with a sinc-like envelope of width ~1/B.
        """
        raw = np.asarray(raw)
        n = raw.shape[axis]
        H = self.matched_filter(n)
        shape = [1] * raw.ndim
        shape[axis] = n
        out = np.fft.ifft(np.fft.fft(raw, axis=axis) * H.reshape(shape),
                          axis=axis)
        # Circular cross-correlation puts the peak at fs*(delay - t0) - L/2,
        # because the reference is stored from index 0 while it represents a
        # pulse centred on zero. Roll forward by half its length so that
        # sample index maps directly to delay.
        return np.roll(out, int(round(self.Tp * self.fs)) // 2, axis=axis)


def get_window(name, n):
    """Amplitude taper. Trades main-lobe width for sidelobe suppression, and
    the tests pin both sides of that trade against published figures."""
    if name is None:
        return np.ones(n)
    if name == "hamming":
        return np.hamming(n)
    if name == "hann":
        return np.hanning(n)
    if name == "taylor":
        from scipy.signal.windows import taylor
        return taylor(n, nbar=4, sll=35, norm=False)
    raise ValueError(f"unknown window {name!r}")
