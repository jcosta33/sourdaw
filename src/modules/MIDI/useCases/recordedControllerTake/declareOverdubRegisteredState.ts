import { recordedControllerTakeState } from '../../repositories/webMidi/recordedControllerTakeState';
import { midiStore } from '../../stores/midiStore';

import { interleaveRegisteredStateDeclarations } from './interleaveRegisteredStateDeclarations';

/**
 * Give the take that just ended, where it recorded into a clip an earlier take already holds rows in,
 * the registered-parameter declarations that keep each take's bends and parameter rows under the state
 * that was live when that take recorded them (`interleaveRegisteredStateDeclarations`).
 *
 * That is an overdub into an existing clip, whose earlier rows are the clip's stored ones, and a take into
 * a clip carried over from an earlier take still waiting for its commit, whose earlier rows are the stored
 * ones, that take's seed and the start of the shared buffer. The take's own state in this clip starts from
 * what the input held when the take first recorded into it (`registeredStateAtFirstRow`). The declarations go into the take's buffered
 * rows, so the write, and for a carried-over clip the commit and its redo snapshot, carry them with the
 * same ids.
 */
export function declareOverdubRegisteredState(clipId: string): void {
    const { buffers, carriedOverClips, bendRangeSeeds } = recordedControllerTakeState;
    const buffer = buffers.get(clipId);
    if (!buffer) {
        return;
    }
    const carriedOver = carriedOverClips.get(clipId);
    const takeStart = carriedOver ?? { cc: 0, pitchBend: 0 };
    const seedRows = carriedOver ? (bendRangeSeeds.get(clipId) ?? []) : [];
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
