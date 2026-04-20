import { setBusGain as setBusGainEngine } from '#/modules/AudioEngine/useCases';

export function setBusGain(busId: string, gain: number): void {
    setBusGainEngine(busId, gain);
}
