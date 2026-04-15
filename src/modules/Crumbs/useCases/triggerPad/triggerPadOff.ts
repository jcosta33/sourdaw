import { logger } from '#/infra/logger/appLogger';
import { crumbsNoteOff } from '../../repositories/crumbsBridge';
import { padStore } from '../../stores/padStore';

export async function triggerPadOff(instanceId: string, padIndex: number): Promise<void> {
    const pads = padStore.value?.[instanceId];
    if (!pads) {
        return;
    }

    const pad = pads.pads[padIndex];
    if (!pad) {
        return;
    }

    try {
        await crumbsNoteOff(instanceId, pad.midiNote);
    } catch (err) {
        logger.warn('Note release failed:', err);
    }
}