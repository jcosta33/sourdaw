import { midiStore } from '../../stores/midiStore';

import { prepareMidiClipGlueState } from './prepareMidiClipGlueState';

type MidiGlueSource = {
    beatOffset: number;
    clipId: string;
    visibleEndBeat: number;
    visibleStartBeat: number;
};

type CanPrepareMidiClipGlueStateInput = {
    sources: readonly MidiGlueSource[];
};

export function canPrepareMidiClipGlueState({ sources }: CanPrepareMidiClipGlueStateInput): boolean {
    const state = midiStore.value;
    if (!state) {
        return false;
    }

    const usedIds = new Set([
        ...Object.keys(state.notesByClipId),
        ...Object.keys(state.ccByClipId),
        ...Object.keys(state.pitchBendByClipId),
        ...(state.migratedAbsoluteNoteClipIds ?? []),
        ...sources.map((source) => source.clipId),
    ]);
    let candidateIndex = 0;
    let targetClipId = '__midi-glue-eligibility-target__';
    while (usedIds.has(targetClipId)) {
        candidateIndex += 1;
        targetClipId = `__midi-glue-eligibility-target-${candidateIndex}__`;
    }

    return prepareMidiClipGlueState({ sources, targetClipId }) !== null;
}
