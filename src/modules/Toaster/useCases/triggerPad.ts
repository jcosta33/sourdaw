/**
 * Trigger a Toaster pad via the audio engine.
 * Finds the active Toaster device and sends a noteOn through toasterControls.
 */

import { ensureTrackStrip } from '#/modules/AudioEngine/useCases/engineAccess';
import { getAllTracks } from '#/modules/Arrangement/useCases/getAllTracks';

export function triggerToasterPad(padIndex: number, velocity: number = 100): void {
    const toasterTrack = getAllTracks().find((t) => t.devices.some((d) => d.type === 'toaster'));
    if (!toasterTrack) {
        return;
    }

    const strip = ensureTrackStrip(toasterTrack.id);
    const dn = strip.deviceNodes.find((d) => d.toasterControls?.ready);
    if (dn?.toasterControls) {
        dn.toasterControls.noteOn(padIndex, velocity);
    }
}
