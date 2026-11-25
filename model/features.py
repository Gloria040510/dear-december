"""Feature contract shared with src/gesture-features.ts."""
import numpy as np


def norm(x):
    return np.linalg.norm(x, axis=-1)


def angles(a, b, c):
    u, v = a - b, c - b
    cosine = np.sum(u * v, axis=-1) / np.maximum(.000001, norm(u) * norm(v))
    return np.arccos(np.clip(cosine, -1, 1)) / np.pi


def features(points, t, confidence):
    p = np.asarray(points)
    palm = p[:, :, [0, 5, 9, 13, 17]].mean(axis=2)
    scale = np.maximum(.022, norm(p[:, :, 0] - p[:, :, 9]))
    d = lambda a, b: norm(p[:, :, a] - p[:, :, b]) / scale
    bends = [angles(p[:, :, a], p[:, :, b], p[:, :, c]) for a, b, c in
             [(1, 2, 3), (5, 6, 7), (9, 10, 11), (13, 14, 15), (17, 18, 19)]]
    normal = np.cross(p[:, :, 5] - p[:, :, 0], p[:, :, 17] - p[:, :, 0])
    facing = np.abs(normal[:, :, 2]) / np.maximum(.000001, norm(normal))
    dt = np.clip(np.diff(t, axis=1), .012, .10)
    v = np.diff(palm, axis=1) / (30 * dt[..., None] * scale[:, 1:, None])
    v = np.clip(np.pad(v, ((0, 0), (1, 0), (0, 0))), -2, 2)
    acc = np.pad(np.diff(v, axis=1), ((0, 0), (1, 0), (0, 0)))
    return np.stack([np.clip(d(4, 8), 0, 3), *(np.clip(d(0, i), 0, 3) for i in (8, 12, 16, 20)),
                     *bends, facing, v[..., 0], v[..., 1], v[..., 2],
                     np.clip(norm(acc), 0, 2), confidence, np.clip(d(8, 20), 0, 3)], axis=-1).astype(np.float32)


def rules(x):
    speed = x[-20:, 11:13]
    path = speed.sum(axis=0)
    if abs(path[0]) > 2.65 and abs(path[0]) > abs(path[1]) * 1.5 and abs(speed[:, 0]).max() > .28:
        return 3
    tail = np.median(x[-5:], axis=0)
    if tail[0] < .36:
        return 2
    if (tail[1:5] < 1.42).sum() >= 3 and (tail[6:10] < .72).sum() >= 2:
        return 1
    if (tail[1:5] > 1.48).sum() >= 3 and (tail[6:10] > .78).sum() >= 3:
        return 0
    return 4
