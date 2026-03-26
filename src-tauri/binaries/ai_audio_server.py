#!/usr/bin/env python3
"""
Sourdaw AI Audio Server — local inference for audio generation and processing.

Models:
  - MusicGen Small (300M) — text-to-music generation
  - Demucs v4 htdemucs — stem separation (vocals/drums/bass/other)

Runs as a standalone HTTP server on localhost.
Start: python3 ai_audio_server.py [--port 8848]
"""

import argparse
import io
import json
import os
import sys
import tempfile
import wave
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path

# Lazy imports to avoid loading heavy deps at startup
_musicgen_model = None
_demucs_model = None


def get_musicgen():
    """Lazy-load MusicGen model."""
    global _musicgen_model
    if _musicgen_model is None:
        print("[AI Audio] Loading MusicGen Small...", flush=True)
        try:
            from audiocraft.models import MusicGen
            _musicgen_model = MusicGen.get_pretrained("facebook/musicgen-small")
            _musicgen_model.set_generation_params(duration=8)
            print("[AI Audio] MusicGen ready.", flush=True)
        except ImportError:
            print("[AI Audio] ERROR: audiocraft not installed. Run: pip install audiocraft", flush=True)
            raise
    return _musicgen_model


def get_demucs():
    """Lazy-load Demucs model."""
    global _demucs_model
    if _demucs_model is None:
        print("[AI Audio] Loading Demucs htdemucs...", flush=True)
        try:
            import torch
            from demucs.pretrained import get_model
            from demucs.apply import apply_model
            _demucs_model = get_model("htdemucs")
            device = "mps" if torch.backends.mps.is_available() else ("cuda" if torch.cuda.is_available() else "cpu")
            _demucs_model.to(device)
            print(f"[AI Audio] Demucs ready on {device}.", flush=True)
        except ImportError:
            print("[AI Audio] ERROR: demucs not installed. Run: pip install demucs", flush=True)
            raise
    return _demucs_model


def generate_music(prompt: str, duration_s: float = 8.0) -> bytes:
    """Generate audio from a text prompt using MusicGen. Returns WAV bytes."""
    import torch
    import numpy as np

    model = get_musicgen()
    model.set_generation_params(duration=min(duration_s, 30.0))  # Cap at 30s

    with torch.no_grad():
        wav = model.generate([prompt])

    # wav is [batch, channels, samples] tensor
    audio_np = wav[0].cpu().numpy()
    if audio_np.ndim == 2:
        audio_np = audio_np[0]  # Take first channel for mono

    # Normalize to int16
    audio_np = np.clip(audio_np, -1.0, 1.0)
    audio_int16 = (audio_np * 32767).astype(np.int16)

    # Write WAV to bytes
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(32000)  # MusicGen outputs at 32kHz
        wf.writeframes(audio_int16.tobytes())
    return buf.getvalue()


def separate_stems(audio_bytes: bytes, stems: list[str] | None = None) -> dict[str, bytes]:
    """Separate audio into stems using Demucs. Returns dict of stem_name -> WAV bytes."""
    import torch
    import numpy as np
    import torchaudio

    model = get_demucs()

    # Load audio from bytes
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        f.write(audio_bytes)
        tmp_path = f.name

    try:
        waveform, sr = torchaudio.load(tmp_path)

        # Resample to Demucs expected sample rate if needed
        if sr != model.samplerate:
            waveform = torchaudio.functional.resample(waveform, sr, model.samplerate)

        # Ensure stereo
        if waveform.shape[0] == 1:
            waveform = waveform.repeat(2, 1)

        device = next(model.parameters()).device
        ref = waveform.mean(0)
        waveform = (waveform - ref.mean()) / ref.std()

        from demucs.apply import apply_model
        sources = apply_model(model, waveform[None].to(device), progress=False)[0]
        sources = sources * ref.std() + ref.mean()

        # Model source names: drums, bass, other, vocals
        source_names = model.sources
        requested = stems if stems else source_names

        result = {}
        for i, name in enumerate(source_names):
            if name in requested or "all" in (stems or []):
                audio_np = sources[i].cpu().numpy()
                # Convert to int16 WAV
                audio_np = np.clip(audio_np, -1.0, 1.0)
                # Take first channel for mono output
                if audio_np.ndim == 2:
                    audio_mono = audio_np[0]
                else:
                    audio_mono = audio_np
                audio_int16 = (audio_mono * 32767).astype(np.int16)

                buf = io.BytesIO()
                with wave.open(buf, "wb") as wf:
                    wf.setnchannels(1)
                    wf.setsampwidth(2)
                    wf.setframerate(model.samplerate)
                    wf.writeframes(audio_int16.tobytes())
                result[name] = buf.getvalue()

        return result
    finally:
        os.unlink(tmp_path)


class AudioHandler(BaseHTTPRequestHandler):
    """HTTP request handler for audio AI operations."""

    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"status": "ok"}).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length)

        if self.path == "/generate":
            self._handle_generate(body)
        elif self.path == "/separate":
            self._handle_separate(body)
        else:
            self.send_response(404)
            self.end_headers()

    def _handle_generate(self, body: bytes):
        try:
            data = json.loads(body)
            prompt = data.get("prompt", "")
            duration = float(data.get("duration_s", 8.0))

            print(f"[AI Audio] Generating: '{prompt}' ({duration}s)", flush=True)
            wav_bytes = generate_music(prompt, duration)

            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(wav_bytes)))
            self.end_headers()
            self.wfile.write(wav_bytes)
            print(f"[AI Audio] Generated {len(wav_bytes)} bytes", flush=True)
        except Exception as e:
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())
            print(f"[AI Audio] Error: {e}", flush=True)

    def _handle_separate(self, body: bytes):
        try:
            # Expect multipart or JSON with base64 audio
            content_type = self.headers.get("Content-Type", "")
            if "application/json" in content_type:
                import base64
                data = json.loads(body)
                audio_bytes = base64.b64decode(data["audio"])
                stems = data.get("stems", ["all"])
            else:
                # Raw WAV upload
                audio_bytes = body
                stems = ["all"]

            print(f"[AI Audio] Separating stems: {stems}", flush=True)
            result = separate_stems(audio_bytes, stems)

            # Return as JSON with base64-encoded WAV for each stem
            import base64
            response = {}
            for name, wav_data in result.items():
                response[name] = base64.b64encode(wav_data).decode()

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(response).encode())
            print(f"[AI Audio] Separated into {len(result)} stems", flush=True)
        except Exception as e:
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())
            print(f"[AI Audio] Error: {e}", flush=True)

    def log_message(self, format, *args):
        # Suppress default request logging
        pass


def main():
    parser = argparse.ArgumentParser(description="Sourdaw AI Audio Server")
    parser.add_argument("--port", type=int, default=8848, help="Port to listen on")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="Host to bind to")
    args = parser.parse_args()

    server = HTTPServer((args.host, args.port), AudioHandler)
    print(f"[AI Audio] Server listening on {args.host}:{args.port}", flush=True)
    print(f"[AI Audio] Endpoints:", flush=True)
    print(f"  GET  /health                - Health check", flush=True)
    print(f"  POST /generate              - Text-to-music (MusicGen)", flush=True)
    print(f"  POST /separate              - Stem separation (Demucs)", flush=True)
    print(f"[AI Audio] Models loaded on first request.", flush=True)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[AI Audio] Shutting down.", flush=True)
        server.shutdown()


if __name__ == "__main__":
    main()
