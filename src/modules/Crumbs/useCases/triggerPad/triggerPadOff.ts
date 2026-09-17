import { logger } from '#/infra/logger/appLogger';

import { crumbsNoteOff } from '../../repositories/crumbsBridge/crumbsNoteOff';
import { padStore } from '../../stores/padStore';

import { resolveCrumbsPadControls } from './resolveCrumbsPadControls';

/**
 * Release one pad on both carriers, for the reason {@link triggerPadOn} states:
 * exactly one of the two is audible, and which one is not knowable from here.
 *
 * The release has to follow the trigger on both sides regardless of which one
 * sounded — a voice left ringing on the silent carrier becomes a stuck note the
 * moment the carrier law flips that strip over.
 */
export async function triggerPadOff(instanceId: string, padIndex: number): Promise<void> {
    const pads = padStore.value?.[instanceId];
    if (!pads) {
        return;
    }

    const pad = pads.pads[padIndex];
    if (!pad) {
        return;
    }

    resolveCrumbsPadControls(instanceId)?.noteOff(pad.midiNote);

    try {
        await crumbsNoteOff(instanceId, pad.midiNote);
    } catch (error) {
        logger.warn('Note release failed:', error);
    }
}
