/**
 * Trigger a Grinder pad via the audio engine.
 * Finds the active Grinder device and sends a noteOn through grinderControls.
 */

import { audioEngine } from '#/modules/AudioEngine/repositories/createWebAudioEngine';
import { getAllTracks } from '#/modules/Arrangement/repositories/track/queries';

export function triggerToasterPad(padIndex: number, velocity: number = 100): void {
    const grinderTrack = getAllTracks().find((t) =>
        t.devices.some((d) => d.type === 'grinder')
    );
    if (!grinderTrack) { return; }

    const strip = audioEngine.ensureTrackStrip(grinderTrack.id);
    const dn = strip.deviceNodes.find((d) => d.grinderControls?.ready);
    if (dn?.grinderControls) {
        dn.grinderControls.noteOn(padIndex, velocity);
    }
}
