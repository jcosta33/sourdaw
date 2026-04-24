import { getAllTracks } from '#/modules/Arrangement/useCases';
import { ensureTrackStrip } from '#/modules/AudioEngine/useCases';

export function triggerToasterPad(deviceId: string, padIndex: number, velocity: number = 100): void {
    const toasterTrack = getAllTracks().find((t) => t.devices.some((d) => d.id === deviceId));
    if (!toasterTrack) {
        return;
    }

    const stripRef = ensureTrackStrip(toasterTrack.id);
    const dn = stripRef.deviceNodes.find((d) => d.deviceId === deviceId);
    if (dn?.toasterControls) {
        dn.toasterControls.noteOn(padIndex, velocity);
    }
}
