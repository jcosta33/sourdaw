import { frozenMidiTakeRepeats, isFrozenMidiTakeSource, projectFrozenMidiTakeWindow } from '#/modules/MIDI/stores';

import { type resolvePlayedMidiClips } from './resolvePlayedMidiClips';

type PlayedClip = ReturnType<typeof resolvePlayedMidiClips>[number];

/** Project one selected take from its original pass clock, including cuts into a pass. */
export function resolveFrozenMidiControllerPasses(clip: PlayedClip) {
    const source = clip.midiTakeSource;
    if (source === undefined) {
        return [];
    }
    if (!isFrozenMidiTakeSource(source)) {
        throw new Error('Invalid frozen MIDI take source');
    }
    const passes = [];
    for (const repeat of frozenMidiTakeRepeats(source, clip.startBeat, clip.endBeat)) {
        const startBeat = Math.max(repeat.startBeat, clip.startBeat);
        const endBeat = Math.min(repeat.endBeat, clip.endBeat);
        if (startBeat >= endBeat) {
            continue;
        }
        const value = projectFrozenMidiTakeWindow({
            source,
            absoluteOccurrenceIndex: repeat.absoluteOccurrenceIndex,
            fromBeat: clip.startBeat,
            toBeat: clip.endBeat,
        });
        if (!value) {
            throw new Error('Invalid frozen MIDI take window');
        }
        passes.push({
            clip: { startBeat, endBeat, midiOffsetBeats: startBeat },
            controlChanges: [...value.controlChanges, ...value.closingControlChanges],
            pitchBends: value.pitchBends,
            sourceControlChanges: source.rows.controlChanges.value,
            sourceBeatOffset: repeat.passHeadBeat - source.sourceEntryBeat,
        });
    }
    return passes;
}
