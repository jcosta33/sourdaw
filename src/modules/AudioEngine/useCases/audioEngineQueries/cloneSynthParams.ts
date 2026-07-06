import { type DrumKitVoice, type SynthParams } from './helpers';

export function cloneSynthParams(params: DrumKitVoice['params']): SynthParams {
    return { ...params };
}
