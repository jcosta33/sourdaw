import { logger } from '#/infra/logger/appLogger';

import { crumbsNoteOff } from '../../repositories/crumbsBridge/crumbsNoteOff';
import { crumbsNoteOn } from '../../repositories/crumbsBridge/crumbsNoteOn';
import { padStore } from '../../stores/padStore';

import { resolveCrumbsPadControls } from './resolveCrumbsPadControls';

/** Clamp a velocity into the MIDI 0..127 range the Rust `u8` field expects. */
function clampVelocity(velocity: number): number {
    if (!Number.isFinite(velocity)) {
        return 0;
    }
    return Math.max(0, Math.min(127, Math.round(velocity)));
}

/** Acquire both carriers and retain their original release targets. */
export function triggerPadOn(instanceId: string, padIndex: number, velocity: number = 100): (() => void) | undefined {
    const pad = padStore.value?.[instanceId]?.pads[padIndex];
    if (!pad) {
        return undefined;
    }

    const clamped = clampVelocity(velocity);
    const releaseWeb = resolveCrumbsPadControls(instanceId)?.startPadAudition(pad.midiNote, clamped);
    const receipt = crumbsNoteOn(instanceId, pad.midiNote, clamped).catch((error: unknown) => {
        logger.warn('Note trigger failed:', error);
        return undefined;
    });
    let released = false;
    return () => {
        if (released) {
            return;
        }
        released = true;
        releaseWeb?.();
        void receipt
            .then((id) => {
                if (id !== undefined) {
                    return crumbsNoteOff(instanceId, id);
                }
                return undefined;
            })
            .catch((error: unknown) => logger.warn('Note release failed:', error));
    };
}
