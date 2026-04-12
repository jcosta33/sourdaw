import { samplerAllSoundOff } from '../../repositories/samplerBridge';
import { samplerStore } from '../../stores/samplerStore';

export async function allSoundOff(): Promise<void> {
    const state = samplerStore.value;
    if (!state?.instanceId) return;

    try {
        await samplerAllSoundOff(state.instanceId);
    } catch (err) {
        console.error('All sound off failed:', err);
    }
}