import { type MidiCC } from '../../models/MidiNote';
import { type RecordedControllerBuffer } from '../../repositories/webMidi/recordedControllerTakeState';

import { readLiveRegisteredStateRows } from './readLiveRegisteredStateRows';

type CaptureRegisteredStateAtFirstRowInput = {
    buffer: RecordedControllerBuffer;
    /**
     * The state the input held before the row's own message moved it, for a row that is itself a
     * registered-parameter message: live input applies a message before it is recorded, and the walk
     * replays the row, so the state it began from is not the live one.
     */
    registeredStateBefore?: readonly MidiCC[];
};

/** Keep the state the take began in for a clip at the first row the take files into it. */
export function captureRegisteredStateAtFirstRow({
    buffer,
    registeredStateBefore,
}: CaptureRegisteredStateAtFirstRowInput): void {
    if (buffer.registeredStateAtFirstRow !== undefined) {
        return;
    }
    buffer.registeredStateAtFirstRow = registeredStateBefore ?? readLiveRegisteredStateRows();
}
