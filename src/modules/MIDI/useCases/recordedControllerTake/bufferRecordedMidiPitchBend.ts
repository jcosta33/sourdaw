import { createMidiError } from '../../errors/MidiError';
import { createMidiPitchBend } from '../../models/MidiNote';
import { type RecordedPitchBendRow } from '../../repositories/webMidi/recordedControllerTakeState';

import { captureRegisteredStateAtFirstRow } from './captureRegisteredStateAtFirstRow';
import { openRecordedControllerBuffer } from './openRecordedControllerBuffer';

type BufferRecordedMidiPitchBendInput = { clipId: string; row: RecordedPitchBendRow };

/** Buffer one pitch-bend message of the take, in arrival order. */
export function bufferRecordedMidiPitchBend({ clipId, row }: BufferRecordedMidiPitchBendInput): void {
    if (![row.value, row.beat, row.channel].every(Number.isFinite)) {
        throw createMidiError('Recorded pitch-bend row must carry finite numbers');
    }
    const buffer = openRecordedControllerBuffer(clipId);
    if (!buffer) {
        return;
    }
    captureRegisteredStateAtFirstRow({ buffer });
    buffer.pitchBend.push(createMidiPitchBend(row.value, row.beat, row.channel, row.zoneMaster));
}
