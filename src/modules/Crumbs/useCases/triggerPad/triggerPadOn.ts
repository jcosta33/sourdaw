import { logger } from '#/infra/logger/appLogger';

import { crumbsNoteOn } from '../../repositories/crumbsBridge';
import { padStore } from '../../stores/padStore';

export async function triggerPadOn(instanceId: string, padIndex: number, velocity: number = 100): Promise<void> {
    const pads = padStore.value?.[instanceId];
    if (!pads) {
        return;
    }

    const pad = pads.pads[padIndex];
    if (!pad) {
        return;
    }

    try {
        await crumbsNoteOn(instanceId, pad.midiNote, velocity);
    } catch (error) {
        logger.warn('Note trigger failed:', error);
    }
}
