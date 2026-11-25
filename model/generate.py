"""Generate reproducible 32-frame synthetic landmark recordings."""
import argparse
from functools import lru_cache
from pathlib import Path
import numpy as np

LABELS = ("Open Palm", "Closed Fist", "Pinch", "Swipe", "Idle")
BASE = Path(__file__).resolve().parent
FRAMES = 32
CHAINS = ((1, 2, 3, 4), (5, 6, 7, 8), (9, 10, 11, 12), (13, 14, 15, 16), (17, 18, 19, 20))


def smoothstep(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


@lru_cache
def template(source):
    """One fixed motion template and trajectory recipe per split group."""
    rng = np.random.default_rng(70353 + source * 929)
    return (
        rng.uniform(.76, 1.28), rng.uniform(-.075, .075),
        rng.uniform(8.5, 17.5), rng.uniform(.79, 1.24),
        rng.uniform(.77, 1.22, 3), rng.uniform(.82, 1.19, 3),
    )

def skeleton(curls, pinch, rng, width):
    points = np.zeros((FRAMES, 21, 3), dtype=np.float32)
    for finger, ids in enumerate(CHAINS):
        # Segment lengths are relative to wrist to middle MCP.
        lengths = ((.27, .22, .18), (.43, .266, .204), (.49, .29, .22),
                   (.448, .28, .207), (.34, .234, .176))[finger]
        base = ((-.45, .35), (-.36, .885), (0, 1), (.31, .916), (.56, .70))[finger]
        yaw = (-.66, -.17, -.015, .115, .275)[finger]
        yaw += rng.normal(0, .075)
        points[:, ids[0], :2] = (base[0] * width, base[1])
        curl = curls[:, finger]
        for j, length in enumerate(lengths, 1):
            angle = curl * (j * .54 + .19) + rng.normal(0, .085)
            length *= rng.uniform(.90, 1.11)
            step = length * np.stack([np.sin(yaw) * np.cos(angle),
                                      np.cos(yaw) * np.cos(angle), np.sin(angle)], axis=-1)
            points[:, ids[j]] = points[:, ids[j - 1]] + step
    # Opposite thumb and index through a smooth three-joint opposition.
    join = points[:, 8].copy()
    join[:, 0] -= .105
    join[:, 2] -= .04
    for j, strength in zip((2, 3, 4), (.29, .60, 1)):
        goal = points[:, 1] + (join - points[:, 1]) * strength
        points[:, j] += (goal - points[:, j]) * pinch[:, None]
    return points


def generate_one(label, source, rng):
    time = np.arange(FRAMES) / 30 + rng.normal(0, .0024, FRAMES)
    phase = rng.uniform(0, 6.28)
    t = np.linspace(0, 1, FRAMES)
    profile = source % 6
    power, delay, waviness, sweep_rate, drift_frequency, drift_amplitude = template(source)
    shape = smoothstep((t - rng.uniform(-.57, .29) - delay) * rng.uniform(2.6, 6.1)) ** power
    if profile == 1:
        shape = np.sqrt(shape)
    elif profile == 2:
        shape = shape ** 2
    elif profile == 3:
        shape = np.clip(shape + .08 * np.sin(t * waviness + phase), 0, 1)
    elif profile == 4:
        shape = np.clip(shape * (.91 + .16 * t), 0, 1)
    hold = rng.uniform(.89, 1.0)
    pinch = np.zeros(FRAMES)
    if label == 0:
        curl = rng.uniform(-.17, .42, 5)
    elif label == 1:
        curl = rng.uniform(1.12, 1.91, 5)
    elif label == 2:
        curl = np.r_[rng.uniform(.05, .8), rng.uniform(.42, .96), rng.uniform(.09, 1.45, 3)]
        pinch = shape * hold
    elif label == 3:
        curl = rng.uniform(.03, 1.07, 5)
    else:
        curl = rng.uniform(.34, 1.46, 5)
        pinch = rng.uniform(.0, .79) * shape if source % 3 == 0 else pinch
        if rng.random() < .28:
            curl = rng.uniform(.18, 1.82, 5)
    initial = rng.uniform(.15, 1.3, 5)
    curls = initial + (curl - initial) * shape[:, None] + np.sin(t * 10 + phase)[:, None] * rng.uniform(.01, .136, 5)
    p = skeleton(curls, pinch, rng, rng.uniform(.83, 1.15))

    angles = rng.uniform(-1.1, 1.1, 3)
    angles[2] *= 2.5
    sx, sy, sz = np.sin(angles)
    cx, cy, cz = np.cos(angles)
    rot_x = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    rot_y = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    rot_z = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    p = p @ (rot_z @ rot_y @ rot_x).T
    if rng.random() < .5:
        p[..., 0] *= -1
    scale = rng.uniform(.048, .135)
    p *= scale * (1 + rng.uniform(-.16, .16) * t[:, None, None])
    trajectory = np.broadcast_to(rng.uniform(.28, .72, 3), (FRAMES, 3)).copy()
    trajectory[:, 2] -= .5
    trajectory += np.sin(t[:, None] * rng.uniform(.7, 9.5, 3) * drift_frequency + phase) * rng.uniform(.008, .056, 3) * drift_amplitude
    if label == 3:
        direction = rng.choice((-1, 1))
        center = rng.uniform(.29, .67)
        sweep = smoothstep((t - center) * rng.uniform(2.2, 4.6) * sweep_rate + .5)
        if profile == 4:
            sweep = np.tanh((t - center) * 4) * .5 + .5
        if profile == 5:
            sweep = np.clip(sweep + .08 * np.sin(t * 7), 0, 1)
        trajectory[:, 0] += direction * rng.uniform(.255, .56) * (sweep - .5)
        trajectory[:, 1] += rng.uniform(-.28, .28) * (sweep - .5)
    elif label == 4:
        sweep = smoothstep((t - rng.uniform(.22, .64)) * 3.9)
        trajectory[:, 0] += rng.uniform(-.22, .22) * sweep + np.sin(t * 10 + phase) * rng.uniform(.013, .065)
        trajectory[:, 1] += rng.uniform(-.36, .36) * sweep
    p += trajectory[:, None]
    p += rng.normal(0, rng.uniform(.0011, .0061), p.shape)
    confidence = rng.uniform(.81, 1, FRAMES)
    if rng.random() < .38:
        start = rng.integers(1, FRAMES - 4)
        length = rng.integers(1, 5)
        confidence[start:start + length] = rng.uniform(.12, .55, length)
        joint_ids = rng.choice(np.arange(1, 21), rng.integers(3, 13), replace=False)
        p[start:start + length, joint_ids] = p[start - 1, joint_ids]
    return p.astype(np.float32), time.astype(np.float32), confidence.astype(np.float32)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--per-group", type=int, default=72)
    parser.add_argument("--out", type=Path, default=BASE / "data" / "synthetic.npz")
    args = parser.parse_args()
    rows, labels, groups = [], [], []
    for source in range(18):
        for label in range(len(LABELS)):
            rng = np.random.default_rng(9127 + source * 601 + label * 137)
            for _ in range(args.per_group):
                rows.append(generate_one(label, source, rng))
                labels.append(label)
                groups.append(source)
    points, time, confidence = map(np.stack, zip(*rows))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(args.out, points=points, time=time, confidence=confidence, labels=labels, groups=groups)
    print(f"{len(rows)} synthetic clips written to {args.out}")


if __name__ == "__main__":
    main()
