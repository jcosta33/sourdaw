import { audioEngine } from '../../repositories/createWebAudioEngine';
import { audioBufferCache } from '../../stores/audioBufferCache';
// @ts-ignore
import { commit_pitch_edit_wasm } from '../../wasm/daw_dsp.js';

export function processPitchEditWasm(
    originalBuffer: AudioBuffer,
    segments: any[],
    contour: any,
    outputAudioPath: string
): void {
    const channelData = originalBuffer.getChannelData(0);
    const newSamples = commit_pitch_edit_wasm(
        channelData, 
        originalBuffer.sampleRate, 
        JSON.stringify(segments), 
        JSON.stringify(contour)
    );
    
    const ctx = audioEngine.context;
    const newBuffer = ctx.createBuffer(1, newSamples.length, originalBuffer.sampleRate);
    newBuffer.copyToChannel(newSamples, 0);
    
    audioBufferCache.set(outputAudioPath, newBuffer);
}
