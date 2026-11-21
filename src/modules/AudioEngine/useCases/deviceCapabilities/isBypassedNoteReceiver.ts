import {
    isBypassedNoteReceiver as isReceiverBypassed,
    type NoteReceivingInstrument,
} from '../../models/NoteReceivingInstrument';

/** Whether the track's receiving instrument is bypassed, which leaves the track silent. */
export function isBypassedNoteReceiver(
    receiver: NoteReceivingInstrument<{ type: string; bypassed?: boolean }> | null
): boolean {
    return isReceiverBypassed(receiver);
}
