import { audioBufferCache } from '../../stores/audioBufferCache';
import { commit_pitch_edit_wasm } from '../../wasm/daw_dsp.js';

import type { PitchContour, PitchSegment } from './analyzePitchForClip';

export function processPitchEditWasm(
    originalBuffer: AudioBuffer,
    segments: PitchSegment[],
    contour: PitchContour,
    outputAudioPath: string
): void {
    const channelData = originalBuffer.getChannelData(0);
    // wasm-bindgen types the return as Float32Array<ArrayBufferLike>; copy it into a
    // plain-ArrayBuffer Float32Array so AudioBuffer.copyToChannel accepts it and the
    // samples stop aliasing wasm linear memory.
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
