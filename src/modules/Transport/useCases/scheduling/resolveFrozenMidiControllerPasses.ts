import { isFrozenMidiTakeSource, projectFrozenMidiTakeWindow } from '#/modules/MIDI/stores';

import { resolvePlayedMidiClips } from './resolvePlayedMidiClips';

type PlayedClip = ReturnType<typeof resolvePlayedMidiClips>[number];

/** Project one selected take from its original pass clock, including cuts into a pass. */
export function resolveFrozenMidiControllerPasses(clip: PlayedClip) {
    const source = clip.midiTakeSource;
    if (!source) {
        return [];
    }
    if (!isFrozenMidiTakeSource(source)) {
        throw new Error('Invalid frozen MIDI take source');
    }
    const span = source.sourceEndBeat - source.sourceEntryBeat;
    const first = Math.max(0, Math.floor((clip.startBeat - source.phaseHeadBeat - span) / source.passLengthBeats) + 1);
    const last = Math.ceil((clip.endBeat - source.phaseHeadBeat) / source.passLengthBeats);
    const passes = [];
    for (let index = first; index < last; index++) {
        const passHead = source.phaseHeadBeat + index * source.passLengthBeats;
        const startBeat = Math.max(passHead, clip.startBeat);
        const endBeat = Math.min(passHead + span, clip.endBeat);
        if (startBeat >= endBeat) {
            continue;
        }
        const value = projectFrozenMidiTakeWindow({
            source,
            absoluteOccurrenceIndex: index,
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
        });
    }
    return passes;
}
