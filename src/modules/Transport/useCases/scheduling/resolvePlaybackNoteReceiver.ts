import { isFaustInstrumentModule } from '#/modules/PluginHost/useCases';
import { type NoteReceivingInstrument, resolveNoteReceivingInstrument } from '#/utils/deviceTypeMatching';

/**
 * The instrument sequenced playback sends a track's notes to: the first
 * note-accepting instrument in its own chain. A Toaster child's route to its
 * parent's kit is the scheduler's separate decision and precedes this one.
 */
export function resolvePlaybackNoteReceiver<TDevice extends { type: string }>(
    devices: readonly TDevice[]
): NoteReceivingInstrument<TDevice> | null {
    return resolveNoteReceivingInstrument(devices, isFaustInstrumentModule);
}
