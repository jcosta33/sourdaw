import { createMidiError } from '../../errors/MidiError';
import { type RecordedCcRow } from '../../repositories/webMidi/recordedControllerTakeState';

import { openRecordedControllerBuffer } from './openRecordedControllerBuffer';

type BufferRecordedMidiCCInput = { clipId: string; row: RecordedCcRow };

/** Buffer one controller message of the take, in arrival order. */
export function bufferRecordedMidiCC({ clipId, row }: BufferRecordedMidiCCInput): void {
    if (!Object.values(row).every(Number.isFinite)) {
        throw createMidiError('Recorded controller row must carry finite numbers');
    }
    openRecordedControllerBuffer(clipId)?.cc.push(row);
}
