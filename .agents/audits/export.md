# Export System Audit

_Audited: 2026-04-04 — all confirmed bugs resolved_

---

## Overview

The export system covers four distinct export types:

| Type | Entry Point | Output |
|------|------------|--------|
| Audio mixdown | `ExportDialog.tsx` → `renderOffline()` | `.wav` / `.mp3` / `.flac` |
| Stems export | `ExportDialog.tsx` → `exportStems()` | Multiple audio files (auto-zipped) |
| Project export | `fileIO.ts :: exportProjectFile()` | `.sourdaw` (JSON + embedded audio) |
| MIDI clip export | `exportMidiFile.ts` | `.mid` |

---

## Resolved Bugs

| # | Issue | Fix |
|---|-------|-----|
| 1 | Audio files silently dropped from project export | `exportProjectFile()` now warns when buffer IDs can't be resolved |
| 2 | MP3 bitrate hardcoded at 128 kbps | `ExportDialog` exposes 96/128/192/320 kbps selector, persisted to localStorage |
| 3 | FLAC MD5 signature zeroed | Inline RFC 1321 MD5 over interleaved LE int16 PCM, written to STREAMINFO |
| 4 | FLAC encoder produced uncompressed output | Full rewrite: FIXED predictor orders 0–4 + partitioned Rice coding, verbatim fallback per block |
| 5 | Zero-duration clips skipped silently | `offlineRender.ts` now calls `onWarning()` with clip name and track name |
| 6 | `float32ToBase64` blocked main thread | Now async with yields every ~256 KB; `exportBuffers` awaits all channels |
| 7 | Render timeout unconditionally 5 minutes | Scaled: `max(60s, durationSeconds × 10)`, applied to both mixdown and stems |
| 8 | Tauri write errors swallowed silently | Removed try/catch in `downloadProjectFile`; errors propagate to caller |
| 9 | Waveform cache not cleared on buffer re-import | `importBuffers()` calls `clearWaveformCachesForId(id)` before caching |
| 10 | MIDI export filename not length-capped | Sanitised name `.slice(0, 200)` before `.mid` extension |

---

## Remaining: Missing Features

These are gaps, not bugs. No data loss or correctness issues.

| Gap | Impact |
|-----|--------|
| No bus/submix stem export — stems are per-track only | Cannot export grouped buses (e.g. drum bus) |
| No loudness normalisation option | Final level depends entirely on project gain staging |
| No audio metadata (ID3/Vorbis comments) in exported files | Title/artist/album absent from exported audio |
| No incremental stem caching — every export re-renders from scratch | Slow iteration when only changing format |
| No multi-file ZIP opt-out — auto-zipped silently when >1 file | Cannot receive loose files |

---

## File Map

| File | Role |
|------|------|
| `src/modules/Project/presentations/views/ExportDialog.tsx` | UI, format/sample-rate/bitrate selection, progress |
| `src/modules/Project/useCases/exportActions.ts` | Facade wrapping render + encode |
| `src/modules/AudioEngine/useCases/offlineRender.ts` | Offline mix engine |
| `src/modules/AudioEngine/repositories/audioEncoders/wavEncoder.ts` | 16/24/32-bit WAV + TPDF dither |
| `src/modules/AudioEngine/repositories/audioEncoders/mp3Encoder.ts` | LAME.js MP3 (configurable bitrate) |
| `src/modules/AudioEngine/repositories/audioEncoders/flacEncoder.ts` | FIXED predictor FLAC + MD5 |
| `src/modules/Project/useCases/projectPersistence/fileIO.ts` | Project JSON export/import + audio serialisation |
| `src/modules/Project/repositories/project/downloadProjectFile.ts` | File save dialog (Tauri / Web / fallback) |
| `src/modules/MIDI/useCases/exportMidiFile.ts` | MIDI clip → `.mid` |
| `src/modules/AudioEngine/stores/audioBufferCache.ts` | LRU cache + IDB persistence + base64 codec |
| `src/modules/Project/models/ProjectData.ts` | Serialised project type |
