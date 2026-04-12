import { logger } from '#/infra/logger/appLogger';
import { samplerNoteOff } from '../../repositories/samplerBridge';
import { samplerStore } from '../../stores/samplerStore';
import { padStore } from '../../stores/padStore';

export async function triggerPadOff(padIndex: number): Promise<void> {
    const state = samplerStore.value;
    const pads = padStore.value;
    if (!state?.instanceId || !pads) {return;}

    const pad = pads.pads[padIndex];
    if (!pad) {return;}

    try {
        await samplerNoteOff(state.instanceId, pad.midiNote);
    } catch (err) {
        logger.warn('Note release failed:', err);
    }
}