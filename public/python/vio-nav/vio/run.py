"""Drive the filter over a dataset."""
import numpy as np
from .imu import Preintegrated, integrate_direct
from .msckf import MSCKF


def run_msckf(ds, window=12, init_bias=True, **kw):
    f = MSCKF(ds.camera, noise=ds.noise, window=window, **kw)
    R0, v0, p0 = ds.truth(0.0)
    f.initialise(R0, v0, p0,
                 bg=ds.bg_true if init_bias else np.zeros(3),
                 ba=ds.ba_true if init_bias else np.zeros(3))
    est_R, est_p, times = [], [], []
    frame = 0
    for k in range(len(ds.imu_t)):
        if frame < len(ds.frame_idx) and k == ds.frame_idx[frame]:
            f.process_frame(ds.imu_t[k], ds.frames[frame])
            est_R.append(f.R.copy()); est_p.append(f.p.copy())
            times.append(ds.imu_t[k]); frame += 1
        if k + 1 < len(ds.imu_t):
            f.propagate(ds.gyro[k], ds.accel[k], ds.imu_dt)
    return f, np.array(times), est_R, np.array(est_p)


def run_dead_reckoning(ds, bg=None, ba=None):
    """IMU-only strapdown, the baseline VIO has to beat."""
    R, v, p = ds.truth(0.0)
    bg = ds.bg_true if bg is None else bg
    ba = ds.ba_true if ba is None else ba
    est_R, est_p, times = [], [], []
    frame = 0
    for k in range(len(ds.imu_t)):
        if frame < len(ds.frame_idx) and k == ds.frame_idx[frame]:
            est_R.append(R.copy()); est_p.append(p.copy())
            times.append(ds.imu_t[k]); frame += 1
        if k + 1 < len(ds.imu_t):
            R, v, p = integrate_direct(R, v, p,
                                       [(ds.gyro[k], ds.accel[k], ds.imu_dt)],
                                       bg, ba)
    return np.array(times), est_R, np.array(est_p)
