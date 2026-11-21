import {
    type NoteReceivingInstrument,
    resolveNoteReceivingInstrument as resolveReceiverInChain,
} from '../../models/NoteReceivingInstrument';

/** The instrument a track's notes reach: the first note-accepting instrument in chain order. */
export function resolveNoteReceivingInstrument<TDevice extends { type: string }>(
    devices: readonly TDevice[],
    isFaustInstrument: (deviceType: string) => boolean
): NoteReceivingInstrument<TDevice> | null {
    return resolveReceiverInChain(devices, isFaustInstrument);
}
