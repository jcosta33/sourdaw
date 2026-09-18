import { clipAudioAssetStagerRef, type ClipAudioAssetStager } from './clipAudioAssetStagingState';

/**
 * Register the stager that turns a cached `AudioBuffer` into a shareable,
 * hash-verified asset (#3759).
 *
 * The seam exists because the encoder lives in AudioRendering and importing
 * its barrel from Arrangement is a module cycle — AudioRendering's own render
 * pipeline imports Arrangement's use cases. The composition root wires the
 * real implementation (see `stageAudioBufferAsset` in AudioRendering and its
 * registration in `src/app/bootstrap.ts`); until then, a staged identity is
 * simply unavailable and clips carry no `assetHash`, exactly as before.
 */
export function setClipAudioAssetStager(next: ClipAudioAssetStager): void {
    clipAudioAssetStagerRef.current = next;
}
