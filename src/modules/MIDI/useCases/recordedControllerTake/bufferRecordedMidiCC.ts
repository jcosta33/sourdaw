import { createMidiError } from '../../errors/MidiError';
import { createMidiCC, type MidiCC } from '../../models/MidiNote';
import { type RecordedCcRow } from '../../repositories/webMidi/recordedControllerTakeState';

import { captureRegisteredStateAtFirstRow } from './captureRegisteredStateAtFirstRow';
import { openRecordedControllerBuffer } from './openRecordedControllerBuffer';

type BufferRecordedMidiCCInput = {
    clipId: string;
    row: RecordedCcRow;
    /** The input's registered-parameter state before `row`'s message was applied to it; see `captureRegisteredStateAtFirstRow`. */
    registeredStateBefore?: readonly MidiCC[];
};

/** Buffer one controller message of the take, in arrival order. */
export function bufferRecordedMidiCC({ clipId, row, registeredStateBefore }: BufferRecordedMidiCCInput): void {
    if (!Object.values(row).every(Number.isFinite)) {
        throw createMidiError('Recorded controller row must carry finite numbers');
    }
    const buffer = openRecordedControllerBuffer(clipId);
    if (!buffer) {
        return;
    }
    captureRegisteredStateAtFirstRow({ buffer, registeredStateBefore });
    buffer.cc.push(createMidiCC(row.controller, row.value, row.beat, row.channel));
}
