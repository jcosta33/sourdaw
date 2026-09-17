import { logger } from '#/infra/logger/appLogger';

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

/**
 * Sound one pad, on both carriers, because exactly one of them is audible
 * (#4204).
 *
 * The native slot takes the note over `crumbs_note_on`. The Web Audio node
 * takes it through the device node on the track's strip. Sending both is not a
 * double hit: the two are mutually exclusive by the carrier law, and neither
 * side can be chosen from here without reading the other's state.
 *
 * - A strip the native session carries has its Web Audio twin gated out of the
 *   mix (`claimCarriedStrips` → `setNativeCarriedTracks`), so the worklet's
 *   voice reaches nothing and only the spliced native instance is heard.
 * - A strip it does not carry has no native chain entry for the device at all:
 *   an unattached or unspliced Crumbs instance runs detached, outside every
 *   chain, so the native voice reaches nothing and only the worklet is heard.
 *
 * Sending one alone is what left the pads silent whenever the instance was not
 * spliced — the case the panel is in before the first Play.
 */
export async function triggerPadOn(instanceId: string, padIndex: number, velocity: number = 100): Promise<void> {
    const pads = padStore.value?.[instanceId];
    if (!pads) {
        return;
    }

    const pad = pads.pads[padIndex];
    if (!pad) {
        return;
    }

    const clamped = clampVelocity(velocity);
    // Before the IPC await, so a native round trip that rejects cannot take the
    // worklet's voice with it.
    resolveCrumbsPadControls(instanceId)?.noteOn(pad.midiNote, clamped);

    try {
        await crumbsNoteOn(instanceId, pad.midiNote, clamped);
    } catch (error) {
        logger.warn('Note trigger failed:', error);
    }
}
