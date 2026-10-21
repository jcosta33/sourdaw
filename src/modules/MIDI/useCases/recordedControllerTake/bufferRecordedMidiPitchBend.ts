import { createMidiError } from '../../errors/MidiError';
import { type RecordedPitchBendRow } from '../../repositories/webMidi/recordedControllerTakeState';

import { openRecordedControllerBuffer } from './openRecordedControllerBuffer';

type BufferRecordedMidiPitchBendInput = { clipId: string; row: RecordedPitchBendRow };

/** Buffer one pitch-bend message of the take, in arrival order. */
export function bufferRecordedMidiPitchBend({ clipId, row }: BufferRecordedMidiPitchBendInput): void {
    if (!Object.values(row).every(Number.isFinite)) {
        throw createMidiError('Recorded pitch-bend row must carry finite numbers');
    }
    openRecordedControllerBuffer(clipId)?.pitchBend.push(row);
}
