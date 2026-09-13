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

    // The WASM render is a per-channel function: one f32 view in, one out. A
    // commit that read only channel 0 and constructed a mono result silently
    // destroyed the right channel of every stereo source it baked — including
    // a zero-shift commit, where the render is the only thing that happens
    // (issue #3720). Every channel renders through the same segments and
    // contour, because the edit is defined on the material, not on a channel.
    const segmentsJson = JSON.stringify(segments);
    const contourJson = JSON.stringify(contour);

    // Each render is a fresh `new Float32Array` — an ArrayBuffer-backed view,
    // which is what `copyToChannel` requires further down.
    // Each render is a fresh `new Float32Array` — an ArrayBuffer-backed view,
    // which is what `copyToChannel` requires further down.
    const renderChannel = (channel: number): Float32Array<ArrayBuffer> =>
        new Float32Array(
            commit_pitch_edit_wasm(
                originalBuffer.getChannelData(channel),
                originalBuffer.sampleRate,
                segmentsJson,
                contourJson
            )
        );

    // Channel 0 first: its rendered length sizes the committed buffer. The
    // render is deterministic in the channel's input, so every channel of one
    // commit returns the same length.
    const renderedFirst = renderChannel(0);
    const renderedChannels: Float32Array<ArrayBuffer>[] = [renderedFirst];
    for (let channel = 1; channel < originalBuffer.numberOfChannels; channel++) {
        renderedChannels.push(renderChannel(channel));
    }

    const newBuffer = new AudioBuffer({
        length: renderedFirst.length,
        numberOfChannels: renderedChannels.length,
        sampleRate: originalBuffer.sampleRate,
    });
    for (const [channel, samples] of renderedChannels.entries()) {
        newBuffer.copyToChannel(samples, channel);
    }

    // Cached under a buffer id, not a file path: the clip is repointed at this key
    // on success, and playback, export and the analysis re-run all resolve a clip's
    // audio through `audioBufferId`. Keyed by path, the render was unreachable.
    audioBufferCache.set(outputAudioBufferId, newBuffer);
}
