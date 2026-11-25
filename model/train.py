"""Train, evaluate and export the five-class temporal CNN."""
import argparse
import json
from pathlib import Path
import numpy as np
import torch
from torch import nn
from torch.utils.data import DataLoader, TensorDataset

from features import features, rules
from generate import BASE, LABELS


class GestureNet(nn.Module):
    def __init__(self):
        super().__init__()
        self.temporal = nn.Sequential(nn.Conv1d(17, 28, 5, padding=2), nn.ReLU(),
                                      nn.Conv1d(28, 40, 5, dilation=2, padding=4), nn.ReLU(),
                                      nn.Conv1d(40, 40, 3, padding=1), nn.ReLU())
        self.head = nn.Sequential(nn.Linear(120, 40), nn.ReLU(), nn.Linear(40, 5))

    def forward(self, x):
        y = self.temporal(x.transpose(1, 2))
        return self.head(torch.cat((y.mean(dim=2), y.amax(dim=2), y[:, :, -10:].mean(dim=2)), dim=1))


def score(target, predicted):
    matrix = np.zeros((5, 5), dtype=int)
    np.add.at(matrix, (target, predicted), 1)
    tp = np.diag(matrix)
    precision = tp / np.maximum(1, matrix.sum(axis=0))
    recall = tp / np.maximum(1, matrix.sum(axis=1))
    f1 = 2 * precision * recall / np.maximum(.000001, precision + recall)
    return dict(accuracy=float(tp.sum() / max(1, len(target))), macroF1=float(np.mean(f1)),
                perClass=dict(zip(LABELS, [dict(precision=float(p), recall=float(r), f1=float(f), support=int(n))
                    for p, r, f, n in zip(precision, recall, f1, matrix.sum(axis=1))])), confusion=matrix.tolist())


def read_real(directory):
    rows, labels = [], []
    for file in sorted(directory.glob("*.json")):
        data = json.loads(file.read_text(encoding="utf-8"))
        for clip in data["clips"]:
            frames = clip["frames"]
            if len(frames) != 32:
                raise ValueError(f"Expected 32 frames in {file}")
            rows.append(([[[p[k] for k in ("x", "y", "z")] for p in f["points"]] for f in frames],
                         [f["t"] / 1000 for f in frames], [f["confidence"] for f in frames]))
            labels.append(LABELS.index(clip["label"]))
    if not rows:
        return None
    xyz, time, confidence = map(np.asarray, zip(*rows))
    return features(xyz, time, confidence), np.array(labels)


def main():
    args = argparse.ArgumentParser()
    args.add_argument("--data", type=Path, default=BASE / "data" / "synthetic.npz")
    args.add_argument("--real", type=Path, default=BASE / "captures")
    args.add_argument("--epochs", type=int, default=28)
    args.add_argument("--out", type=Path, default=BASE.parent / "public" / "model")
    opts = args.parse_args()
    torch.manual_seed(74823)
    torch.set_num_threads(4)
    data = np.load(opts.data)
    x = features(data["points"], data["time"], data["confidence"])
    y, group = data["labels"], data["groups"]
    train, val, test = group < 12, (group >= 12) & (group < 15), group >= 15
    model = GestureNet()
    loader = DataLoader(TensorDataset(torch.tensor(x[train]), torch.tensor(y[train])), batch_size=128, shuffle=True)
    optimizer = torch.optim.AdamW(model.parameters(), lr=.0021)
    loss_fn = nn.CrossEntropyLoss(label_smoothing=.035)
    best_accuracy, best_state = -1., None

    def predict(inputs):
        with torch.no_grad():
            return model(torch.tensor(inputs)).argmax(dim=1).numpy()

    for epoch in range(opts.epochs):
        model.train()
        for xb, yb in loader:
            optimizer.zero_grad()
            loss = loss_fn(model(xb), yb)
            loss.backward()
            optimizer.step()
        model.eval()
        accuracy = float(np.mean(predict(x[val]) == y[val]))
        if accuracy > best_accuracy:
            best_accuracy = accuracy
            best_state = {key: value.clone() for key, value in model.state_dict().items()}
        if (epoch + 1) % 4 == 0:
            print(f"epoch {epoch + 1:2d}: validation accuracy {accuracy:.3f}", flush=True)
    model.load_state_dict(best_state)
    compare = lambda xx, yy: dict(samples=len(yy), temporalCNN=score(yy, predict(xx)),
                                  rules=score(yy, np.array([rules(sequence) for sequence in xx])))
    real = read_real(opts.real)
    report = dict(classes=LABELS, seed=74823, syntheticClips=len(y), trainingClips=int(train.sum()),
                  validationClips=int(val.sum()), splitGroups=dict(train=list(range(12)), validation=[12, 13, 14], test=[15, 16, 17]),
                  bestValidationAccuracy=best_accuracy, syntheticTest=compare(x[test], y[test]),
                  realTest=compare(*real) if real else None)
    opts.out.mkdir(parents=True, exist_ok=True)
    torch.onnx.export(model, torch.zeros(1, 32, 17), opts.out / "gesture.onnx", input_names=["landmarks"],
                      output_names=["logits"], opset_version=17, dynamo=False)
    (opts.out / "metrics.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    # Pin one held-out window for deterministic browser latency and prediction checks.
    idx = np.flatnonzero(test)[0]
    fixture = dict(raw=np.round(data["points"][idx], 7).tolist(), time=data["time"][idx].tolist(),
                   confidence=data["confidence"][idx].tolist(), expected=int(predict(x[idx:idx + 1])[0]))
    (opts.out / "benchmark.json").write_text(json.dumps(fixture, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({k: {"cnnAccuracy": v["temporalCNN"]["accuracy"], "rulesAccuracy": v["rules"]["accuracy"],
                          "samples": v["samples"]} if v else None
                      for k, v in (("syntheticTest", report["syntheticTest"]), ("realTest", report["realTest"]))}, indent=2))


if __name__ == "__main__":
    main()
