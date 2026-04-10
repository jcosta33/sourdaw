/**
 * Trigger a Toaster pad via the audio engine.
 * Finds the active Toaster device and sends a noteOn through toasterControls.
 */

import { inject } from '#/infra/di/inject';
import { getAllTracks } from '#/modules/Arrangement';
import { ensureTrackStrip } from '#/modules/AudioEngine';

export const triggerToasterPadDependencies = {
    getAllTracks,
    ensureTrackStrip,
} as const;

export const triggerToasterPad = inject(triggerToasterPadDependencies)(({ getAllTracks, ensureTrackStrip }) =>
    function triggerToasterPad(padIndex: number, velocity: number = 100): void {
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
);
