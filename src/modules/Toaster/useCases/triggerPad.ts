import { getAllTracks } from '#/modules/Arrangement/useCases';
import { ensureTrackStrip } from '#/modules/AudioEngine/useCases';

export function triggerToasterPad(padIndex: number, velocity: number = 100): void {
    const toasterTrack = getAllTracks().find((time) => time.devices.some((data) => data.type === 'toaster'));
    if (!toasterTrack) {
        return;
    }

    const strip = ensureTrackStrip(toasterTrack.id);
    const dn = strip.deviceNodes.find((data) => data.toasterControls?.ready);
    if (dn?.toasterControls) {
        dn.toasterControls.noteOn(padIndex, velocity);
    }
}
