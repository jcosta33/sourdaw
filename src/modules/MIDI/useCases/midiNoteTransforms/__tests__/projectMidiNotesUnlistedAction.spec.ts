import { describe, expect, it } from 'vitest';

import { midiStore } from '../../../stores/midiStore';
import { projectMidiNotesByClipIdThroughRestores } from '../projectMidiNotesByClipIdThroughRestores';

describe('projectMidiNotesByClipIdThroughRestores', () => {
    it('leaves the live notes buckets as they were for an action that writes no notes', () => {
        const before = projectMidiNotesByClipIdThroughRestores([]);

        expect(projectMidiNotesByClipIdThroughRestores([{ type: 'togglePlayback' }])).toEqual(before);
        expect(midiStore.value?.notesByClipId ?? {}).toEqual(before);
    });
});
