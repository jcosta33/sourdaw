import { isFrozenMidiTakeSource } from '#/modules/MIDI/stores';

import { type MidiTakeSource } from '../../models/TakeLane';

/** Preserve source rows and move only their song-time phase with a re-keyed fragment. */
export function relocateMidiTakeSource(
    source: MidiTakeSource,
    preImageStartBeat: number,
    targetStartBeat: number
): MidiTakeSource | null {
    if (!isFrozenMidiTakeSource(source) || !Number.isFinite(preImageStartBeat) || !Number.isFinite(targetStartBeat)) {
        return null;
    }
    const moved = {
        ...source,
        phaseHeadBeat: source.phaseHeadBeat + targetStartBeat - preImageStartBeat,
    };
    return isFrozenMidiTakeSource(moved) ? moved : null;
}
