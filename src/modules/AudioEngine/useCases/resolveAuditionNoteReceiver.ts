import { isFaustInstrumentModule } from '#/modules/PluginHost/useCases';
import { type NoteReceivingInstrument, resolveNoteReceivingInstrument } from '#/utils/deviceTypeMatching';

/**
 * The instrument an auditioned note plays on: the first note-accepting
 * instrument in the chain, the one playback, export and live input voice. A
 * note auditioned on a Toaster child is a pad of its parent's kit and goes to
 * that toaster, whatever else the parent's chain holds.
 */
export function resolveAuditionNoteReceiver<TDevice extends { type: string }>(
    devices: readonly TDevice[],
    routesToToasterPad: boolean
): NoteReceivingInstrument<TDevice> | null {
    if (routesToToasterPad) {
        const toaster = devices.find((device) => device.type === 'toaster');
        return toaster ? { device: toaster, kind: 'toaster' } : null;
    }
    return resolveNoteReceivingInstrument(devices, isFaustInstrumentModule);
}
