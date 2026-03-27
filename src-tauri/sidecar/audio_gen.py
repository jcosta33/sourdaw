#!/usr/bin/env python3
"""Sourdaw audio generation sidecar — Stable Audio Open Small.

Reads JSON requests from stdin, generates audio, writes JSON responses to stdout.
Model stays loaded between requests (warm inference).

Protocol: one JSON object per line (JSON Lines).
Commands: load, generate, ping, quit
"""
import sys
import os
import json
import argparse
import traceback
import tempfile

# Force line-buffered stdout for reliable IPC
sys.stdout = os.fdopen(sys.stdout.fileno(), "w", buffering=1)


def emit(msg: dict):
    """Write one JSON line to stdout, immediately flushed."""
    sys.stdout.write(json.dumps(msg) + "\n")
    sys.stdout.flush()


def log(msg: str):
    """Logging goes to stderr to keep the stdout protocol clean."""
    print(msg, file=sys.stderr, flush=True)


def get_device():
    import torch

    if torch.cuda.is_available():
        return "cuda"
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        os.environ["PYTORCH_ENABLE_MPS_FALLBACK"] = "1"
        return "mps"
    return "cpu"


# ── Stable Audio Open Backend ──────────────────────────────────────


class StableAudioBackend:
    def __init__(self, device=None):
        import torch
        from stable_audio_tools import get_pretrained_model

        self.device = device or get_device()
        model_name = "stabilityai/stable-audio-open-small"
        log(f"Loading '{model_name}' on {self.device}...")

        self.model, self.config = get_pretrained_model(model_name)
        self.sample_rate = self.config["sample_rate"]  # 44100
        self.sample_size = self.config["sample_size"]

        # float32 required for MPS; float16 ok for CUDA
        import torch as _torch

        dtype = _torch.float32 if self.device == "mps" else _torch.float16
        self.model = self.model.to(device=self.device, dtype=dtype)
        log(f"Stable Audio Open Small loaded. Sample rate: {self.sample_rate}")

    def generate(self, request: dict) -> str:
        import torch
        import torchaudio
        from einops import rearrange
        from stable_audio_tools.inference.generation import generate_diffusion_cond

        rid = request.get("requestId", "unknown")
        prompt = request.get("prompt", "")
        duration = min(request.get("duration_seconds", 8.0), 11.0)
        output_dir = request.get("output_dir", tempfile.gettempdir())

        # Small model: 8 steps, pingpong sampler
        steps, sampler, cfg = 8, "pingpong", 1.0

        conditioning = [{"prompt": prompt, "seconds_total": duration}]

        emit(
            {
                "type": "progress",
                "requestId": rid,
                "progress": 0.15,
                "message": f"Running {steps}-step diffusion ({duration:.1f}s)",
            }
        )

        with torch.inference_mode():
            output = generate_diffusion_cond(
                self.model,
                steps=steps,
                cfg_scale=cfg,
                conditioning=conditioning,
                sample_size=self.sample_size,
                sigma_min=0.3,
                sigma_max=500,
                sampler_type=sampler,
                device=self.device,
            )

        emit(
            {
                "type": "progress",
                "requestId": rid,
                "progress": 0.9,
                "message": "Saving WAV",
            }
        )

        output = rearrange(output, "b d n -> d (b n)")
        output = output.to(torch.float32).div(
            torch.max(torch.abs(output)).clamp(min=1e-8)
        ).clamp(-1, 1)

        out_path = os.path.join(output_dir, f"{rid}.wav")
        torchaudio.save(out_path, output.cpu(), self.sample_rate)

        if self.device == "cuda":
            torch.cuda.empty_cache()

        return out_path


# ── Prompt enrichment ──────────────────────────────────────────────


def build_audio_prompt(request: dict) -> str:
    """Combine structured metadata with the user's text prompt."""
    parts = []
    bpm = request.get("bpm")
    key = request.get("key")
    prompt = request.get("prompt", "")

    if bpm:
        parts.append(f"{int(bpm)} BPM")
    parts.append(prompt)
    if key:
        parts.append(f"in {key}")
    parts.append("high quality, clear, professional")
    return ", ".join(parts)


# ── Main Loop ──────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(description="Sourdaw Audio Generation Sidecar")
    parser.add_argument("--model-dir", default=None, help="HuggingFace cache directory")
    args = parser.parse_args()

    if args.model_dir:
        os.environ["HF_HUB_CACHE"] = args.model_dir
        os.environ["TORCH_HOME"] = args.model_dir

    device = get_device()
    emit({"type": "ready", "device": device, "backend": "stable-audio-small"})

    backend = None

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            request = json.loads(line)
        except json.JSONDecodeError as e:
            emit({"type": "error", "requestId": "unknown", "error": f"Invalid JSON: {e}"})
            continue

        cmd = request.get("command", "generate")
        rid = request.get("requestId", "unknown")

        try:
            if cmd == "load":
                backend = StableAudioBackend(device=device)
                emit({"type": "loaded", "requestId": rid, "backend": "stable-audio-small"})

            elif cmd == "generate":
                if backend is None:
                    emit(
                        {
                            "type": "progress",
                            "requestId": rid,
                            "progress": 0.05,
                            "message": "Loading model (~1.7 GB, first run only)...",
                        }
                    )
                    backend = StableAudioBackend(device=device)
                    emit({"type": "loaded", "requestId": rid, "backend": "stable-audio-small"})

                # Calculate duration from bars + BPM if provided
                bpm = request.get("bpm", 120)
                bars = request.get("duration_bars")
                if bars:
                    beats_per_bar = request.get("beats_per_bar", 4)
                    duration_s = (bars * beats_per_bar * 60.0) / bpm
                else:
                    duration_s = request.get("duration_seconds", 8.0)

                enriched = dict(request)
                enriched["prompt"] = build_audio_prompt(request)
                enriched["duration_seconds"] = duration_s

                wav_path = backend.generate(enriched)
                emit(
                    {
                        "type": "result",
                        "requestId": rid,
                        "wavPath": wav_path,
                        "duration": duration_s,
                        "sampleRate": backend.sample_rate,
                    }
                )

            elif cmd == "ping":
                emit({"type": "pong", "requestId": rid})

            elif cmd == "quit":
                emit({"type": "shutdown"})
                break

        except Exception as e:
            log(traceback.format_exc())
            emit({"type": "error", "requestId": rid, "error": f"{type(e).__name__}: {e}"})


if __name__ == "__main__":
    main()
