import { denoiseAudio as denoiseAudioFromNativeBridge } from '../../repositories/nativeAIBridge/audioDenoising';

export function denoiseAudio(
    ...args: Parameters<typeof denoiseAudioFromNativeBridge>
): ReturnType<typeof denoiseAudioFromNativeBridge> {
    return denoiseAudioFromNativeBridge(...args);
}