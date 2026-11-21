import { type MidiNote, midiStore } from '#/modules/MIDI/stores';

import { type Track } from '../../stores/trackStore';

export type FreezeMidiNoteSnapshot = Record<string, MidiNote[]>;

/** The notes a freeze render reads, copied at the moment the freeze starts. */
export function captureFreezeMidiNotes(clips: Track['clips']): FreezeMidiNoteSnapshot {
    const snapshot: FreezeMidiNoteSnapshot = {};
    for (const clip of clips) {
        if (clip.type !== 'midi') {
            continue;
        }
        snapshot[clip.id] = structuredClone(midiStore.value?.notesByClipId[clip.id] ?? []);
    }
    return snapshot;
}
