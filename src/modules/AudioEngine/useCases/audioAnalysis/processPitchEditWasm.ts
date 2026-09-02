import { audioBufferCache } from '../../stores/audioBufferCache';

import type { PitchContour, PitchSegment } from './analyzePitchForClip';

// `commit_pitch_edit_wasm` shares the same wasm-bindgen glue as
// `analyze_pitch_wasm`. Load `daw_dsp.js` only at call time so the AudioEngine
// useCases barrel can evaluate after a failed WASM graph. Analysis still
// precedes an edit in the product flow; this path also inits the glue if an
// edit reaches here first.
export async function processPitchEditWasm(
    originalBuffer: AudioBuffer,
    segments: PitchSegment[],
    contour: PitchContour,
    outputAudioBufferId: string
): Promise<void> {
    const { commit_pitch_edit_wasm, default: initDawDsp } = await import('#/modules/AudioEngine/wasm/daw_dsp.js');
    await initDawDsp();
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

    // Cached under a buffer id, not a file path: the clip is repointed at this key
    // on success, and playback, export and the analysis re-run all resolve a clip's
    // audio through `audioBufferId`. Keyed by path, the render was unreachable.
    audioBufferCache.set(outputAudioBufferId, newBuffer);
}
