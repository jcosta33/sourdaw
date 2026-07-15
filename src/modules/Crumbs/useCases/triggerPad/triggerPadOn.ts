import { logger } from '#/infra/logger/appLogger';

import { crumbsNoteOn } from '../../repositories/crumbsBridge/crumbsNoteOn';
import { padStore } from '../../stores/padStore';

/** Clamp a velocity into the MIDI 0..127 range the Rust `u8` field expects. */
function clampVelocity(velocity: number): number {
    if (!Number.isFinite(velocity)) {
        return 0;
    }
    return Math.max(0, Math.min(127, Math.round(velocity)));
}

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
        await crumbsNoteOn(instanceId, pad.midiNote, clampVelocity(velocity));
    } catch (error) {
        logger.warn('Note trigger failed:', error);
    }
}
