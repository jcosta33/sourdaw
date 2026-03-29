/**
 * Trigger a Grinder pad via the audio engine.
 * Finds the active Grinder device and sends a noteOn through grinderControls.
 */

import { ensureTrackStrip } from '#/modules/AudioEngine/useCases/engineAccess';
import { getAllTracks } from '#/modules/Arrangement/useCases/trackQueries';

export function triggerToasterPad(padIndex: number, velocity: number = 100): void {
    const grinderTrack = getAllTracks().find((t) =>
        t.devices.some((d) => d.type === 'grinder')
    );
    if (!grinderTrack) { return; }

    const strip = ensureTrackStrip(grinderTrack.id);
    const dn = strip.deviceNodes.find((d) => d.grinderControls?.ready);
    if (dn?.grinderControls) {
        dn.grinderControls.noteOn(padIndex, velocity);
    }
}
