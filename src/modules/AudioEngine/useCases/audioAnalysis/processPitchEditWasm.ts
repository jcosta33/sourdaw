import { audioBufferCache } from '../../stores/audioBufferCache';
import { commit_pitch_edit_wasm } from '../../wasm/daw_dsp.js';

import type { PitchContour, PitchSegment } from './analyzePitchForClip';

// `commit_pitch_edit_wasm` shares the same wasm-bindgen glue as
// `analyze_pitch_wasm`. This function is synchronous, so it cannot await the
// main-thread init itself; it relies on `analyzePitchForClip` having run first
// in the same realm (analysis always precedes an edit) to have initialized the
// glue singleton via `ensureMainThreadWasmInit`. Reordering the two so an edit
// can precede analysis would need this call to become async and await that init.
export function processPitchEditWasm(
    originalBuffer: AudioBuffer,
    segments: PitchSegment[],
    contour: PitchContour,
    outputAudioPath: string
): void {
    const channelData = originalBuffer.getChannelData(0);
    // The regenerated .d.ts types the return as generic Float32Array
    // (Float32Array<ArrayBufferLike>), but AudioBuffer.copyToChannel requires
    // Float32Array<ArrayBuffer>; re-wrapping narrows the buffer generic cast-free.
    // (The glue already .slice()s the wasm memory, so no aliasing is involved.)
    const newSamples = new Float32Array(
        commit_pitch_edit_wasm(
            channelData,
            originalBuffer.sampleRate,
            JSON.stringify(segments),
            JSON.stringify(contour)
        )
    );

    const newBuffer = new AudioBuffer({
        length: newSamples.length,
        numberOfChannels: 1,
        sampleRate: originalBuffer.sampleRate,
    });
    newBuffer.copyToChannel(newSamples, 0);

    audioBufferCache.set(outputAudioPath, newBuffer);
}
