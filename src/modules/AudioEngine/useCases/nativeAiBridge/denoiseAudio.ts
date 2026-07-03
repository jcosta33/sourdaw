import { denoiseAudio as denoiseAudioFromNativeBridge } from '../../repositories/nativeAIBridge/audioDenoising';

import { toDenoiseResult, type DenoiseResult } from './helpers';

type DenoiseAudioOutput = Promise<DenoiseResult>;

export function denoiseAudio(
    samples: Float32Array,
    sampleRate: number,
    channels: number,
    strength = 0.7
): DenoiseAudioOutput {
    return denoiseAudioFromNativeBridge(samples, sampleRate, channels, strength).then(toDenoiseResult);
}
