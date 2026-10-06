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

- **`repositories/audioEncoders/`**: Pure JS/WASM encoder pipelines (`wavEncoder.ts`, `mp3Encoder.ts`, `flacEncoder.ts`), dithering and PCM conversion (`convertFloatChannelsToPcm.ts`, `resolveNormalizationGain.ts`). BS.1770 loudness and true-peak metering is imported from `src/utils/audioMetering/`.
- **`repositories/audioExport/`**: Native filesystem bridge export writers (`writeNativeAudioMixdownFile.ts`, `writeNativeAudioStemFile.ts`, `selectNativeAudioExportFile.ts`, `selectNativeAudioExportDirectory.ts`).
- **`presentations/views/`**: `ExportDialog.tsx` UI for configuring format, sample rate, bit depth, normalization, and stem selection.
- **`models/`**: `AgentSectionRenderArtifact.ts`, `AgentSectionRenderRetentionPolicy.ts`.

## Invariants & Traps

- **Loudness and true peak conformance**: Normalization (EBU R128 / ITU-R BS.1770-4) applies dual-stage K-weighting filtering (high-pass and high-shelf) and oversampled true peak calculation before applying normalization gain.
- **Dither on bit-depth reduction**: Downsampling from 32-bit float to 24-bit or 16-bit PCM must apply triangular probability density function (TPDF) dither to prevent quantization distortion.
- **Chunked non-blocking encoding**: Encoding large multi-channel audio buffers into MP3 or FLAC can saturate the main thread; long exports must process in incremental chunks or worker contexts.
- **Desktop vs browser file delivery**: Desktop environment writes files directly to the filesystem via `desktopBridge`; web browser builds trigger download blobs.
- **A measurement reports the renders it starts and can retract what it retained**: the measurement renderers call `onRenderStart` as each target's render begins, so a caller counts the renders that ran rather than the renders it planned, and `discardAgentMeasurementArtifacts` drops the artifacts a measurement retained when it then stops before it reports.
- **A preview measurement holds no preview across a render**: `renderAgentPreviewMeasurementScope` takes every store read both renders need — targets, range seconds and the preview's whole render source — synchronously, the preview's through its workspace `scope`, and releases the workspace before the first render starts. The preview renders a detached copy, so it cannot write the live document or stores and no preview is active across an await. Both renders are bound to the workspace's base revision: once the live project leaves it, the comparison refuses as a whole and retains nothing.
- **A preview measurement never measures a document it did not render**: its delta becomes evidence a person approves against, so a preview device the render cannot carry from the preview's own data refuses the comparison with a typed reason naming the device — `unprojectable-device-state` for a Yeast rack the preview stores differently from the live rack the render reads, or for the devices whose ownership of a legacy single-rack slot the preview moves by putting another Yeast device first, `unrenderable-preview-device` for a hosted plugin the proposal created that no loaded instance backs. Neither degrades to a warning.

## Verification

- **Focused unit tests**: `pnpm test:run src/modules/AudioRendering`
- **Module boundaries**: `pnpm deps:validate`
