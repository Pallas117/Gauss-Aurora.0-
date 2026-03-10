"""
Export a minimal nowcast-style model to ONNX for use with onnxruntime-node.
Input: (batch, 3) = speed, density, bz from last sequence point.
Output: (batch, 4) = geomagnetic_perturbation, aurora_intensity, confidence, step (for one step).
Run from repo root: python3 ml/export/export_nowcast_onnx.py
Output: services/ml-inference/model.onnx (or path from env ONNX_OUTPUT_PATH).
"""
import gc
import os
import sys

try:
    import torch
except ImportError:
    print("pip install torch", file=sys.stderr)
    sys.exit(1)


class MinimalNowcast(torch.nn.Module):
    def forward(self, x):
        # x: (N, 3) = speed, density, bz
        speed = x[:, 0:1]
        density = x[:, 1:2]
        bz = x[:, 2:3]
        driver = torch.clamp(-bz, min=0) * 0.45 + (speed - 350) * 0.004 + density * 0.05
        geomagnetic = 2 * 8 + driver * 12
        aurora = torch.sigmoid(geomagnetic / 20)
        confidence = torch.full_like(aurora, 0.85)
        step = torch.full_like(aurora, 5.0)
        out = torch.cat([geomagnetic, aurora, confidence, step], dim=1)
        gc.collect()
        return out


def main():
    model = MinimalNowcast()
    model.eval()
    dummy = torch.tensor([[400.0, 5.0, -3.0]], dtype=torch.float32)
    out_dir = os.path.join(os.path.dirname(__file__), "..", "..", "services", "ml-inference")
    os.makedirs(out_dir, exist_ok=True)
    path = os.environ.get("ONNX_OUTPUT_PATH", os.path.join(out_dir, "model.onnx"))
    torch.onnx.export(
        model,
        dummy,
        path,
        input_names=["input"],
        output_names=["output"],
        dynamic_axes={"input": {0: "batch"}, "output": {0: "batch"}},
        opset_version=14,
    )
    print("Exported:", path)
    gc.collect()


if __name__ == "__main__":
    main()
