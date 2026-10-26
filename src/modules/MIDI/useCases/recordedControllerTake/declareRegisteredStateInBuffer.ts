import {
    type RecordedControllerBuffer,
    type RecordedRowCounts,
} from '../../repositories/webMidi/recordedControllerTakeState';
import { midiStore } from '../../stores/midiStore';

import { interleaveRegisteredStateDeclarations } from './interleaveRegisteredStateDeclarations';

type DeclareRegisteredStateInBufferInput = {
    clipId: string;
    buffer: RecordedControllerBuffer;
    /** Where the take's own rows begin in the buffer: past the earlier take's rows of a carried-over clip. */
    takeStart: RecordedRowCounts;
    /** The earlier take's seed rows, which a carried-over clip's buffer does not hold. */
    seedRows: readonly RecordedControllerBuffer['cc'][number][];
};

/**
 * Write a take's registered-parameter declarations into `buffer`, against the
 * rows the clip holds in the store now plus the earlier take's own rows
 * (`interleaveRegisteredStateDeclarations`).
 */
export function declareRegisteredStateInBuffer({
    clipId,
    buffer,
    takeStart,
    seedRows,
}: DeclareRegisteredStateInBufferInput): void {
    const storedCc = midiStore.value?.ccByClipId[clipId] ?? [];
    const storedPitchBend = midiStore.value?.pitchBendByClipId[clipId] ?? [];
    const earlier = {
        cc: [...storedCc, ...seedRows, ...buffer.cc.slice(0, takeStart.cc)],
        pitchBend: [...storedPitchBend, ...buffer.pitchBend.slice(0, takeStart.pitchBend)],
    };
    const overdub = { cc: buffer.cc.slice(takeStart.cc), pitchBend: buffer.pitchBend.slice(takeStart.pitchBend) };
    buffer.cc = [
        ...buffer.cc.slice(0, takeStart.cc),
        ...interleaveRegisteredStateDeclarations({
            earlier,
            overdub,
            overdubStartState: buffer.registeredStateAtFirstRow ?? [],
        }),
    ];
}
