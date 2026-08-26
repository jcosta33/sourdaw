# AudioRendering module — Agent Guidelines

Audio encoding and export pipeline: encodes master/stem audio buffers into target formats (WAV, MP3, FLAC), enforces loudness/true peak standards, and writes native export files.

## Domain Ownership

Owns audio export encoding (WAV, MP3, FLAC), export normalization (LUFS / true peak conformance, dithering, bit-depth conversion), project section render artifacts, and native file export I/O. Does not own offline DSP graph rendering (AudioEngine) or project timeline models (Arrangement).

## Public Contract Surface

- **`useCases`**: `audioBufferToWav`, `audioBufferToMp3`, `audioBufferToFlac`, `normalizeExportBuffer`, `clearAgentSectionRenderArtifacts`, `getAgentSectionRenderArtifacts`, `retryAgentProjectSectionRenders`, `getAudioRenderingHandlers`.
- **`presentations/views`**: `ExportDialog`.
- **`events`**: None.
- **`stores`**: None (internal `agentSectionRenderArtifactStore`).
- **Handler maps**: `getAudioRenderingHandlers` (`handleRenderProjectSections`, `handleRemoveRenderedProjectSections`).

## Key Subsystems

- **`repositories/audioEncoders/`**: Pure JS/WASM encoder pipelines (`wavEncoder.ts`, `mp3Encoder.ts`, `flacEncoder.ts`), K-weighting filters (`createKWeightingFilters.ts`), integrated loudness and true peak measurement (`measureIntegratedLoudness.ts`, `measureTruePeak.ts`), dithering and PCM conversion (`convertFloatChannelsToPcm.ts`, `resolveNormalizationGain.ts`).
- **`repositories/audioExport/`**: Native filesystem bridge export writers (`writeNativeAudioMixdownFile.ts`, `writeNativeAudioStemFile.ts`, `selectNativeAudioExportFile.ts`, `selectNativeAudioExportDirectory.ts`).
- **`presentations/views/`**: `ExportDialog.tsx` UI for configuring format, sample rate, bit depth, normalization, and stem selection.
- **`models/`**: `AgentSectionRenderArtifact.ts`, `AgentSectionRenderRetentionPolicy.ts`.

## Invariants & Traps

- **Loudness and true peak conformance**: Normalization (EBU R128 / ITU-R BS.1770-4) applies dual-stage K-weighting filtering (high-pass and high-shelf) and oversampled true peak calculation before applying normalization gain.
- **Dither on bit-depth reduction**: Downsampling from 32-bit float to 24-bit or 16-bit PCM must apply triangular probability density function (TPDF) dither to prevent quantization distortion.
- **Chunked non-blocking encoding**: Encoding large multi-channel audio buffers into MP3 or FLAC can saturate the main thread; long exports must process in incremental chunks or worker contexts.
- **Desktop vs browser file delivery**: Desktop environment writes files directly to the filesystem via `desktopBridge`; web browser builds trigger download blobs.

## Verification

- **Focused unit tests**: `pnpm test:run src/modules/AudioRendering`
- **Module boundaries**: `pnpm deps:validate`
