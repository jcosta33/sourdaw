import { getAllTracks } from '#/modules/Arrangement/useCases';
import { ensureTrackStrip } from '#/modules/AudioEngine/useCases';

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
