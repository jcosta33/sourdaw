import { beforeEach, describe, expect, it } from 'vitest';

import { chordTrackStore } from '../../../stores/chordTrackStore';
import { replaceChordTrackState } from '../replaceChordTrackState';

describe('replaceChordTrackState', () => {
    beforeEach(() => {
        chordTrackStore.set({
            enabled: true,
            events: [{ id: 'existing', beat: 0, root: 0, quality: 'major', duration: 4 }],
        });
    });

    it('replaces chord-track truth without retaining caller-owned references', () => {
        const event = { id: 'replacement', beat: 8, root: 9, quality: 'min9' as const, duration: 8 };
        const replacement = { enabled: false, events: [event] };

        replaceChordTrackState(replacement);

        expect(chordTrackStore.value).toEqual(replacement);

        event.root = 11;
        replacement.events.push({ id: 'caller-only', beat: 16, root: 2, quality: 'min9', duration: 4 });

        expect(chordTrackStore.value).toEqual({
            enabled: false,
            events: [{ id: 'replacement', beat: 8, root: 9, quality: 'min9', duration: 8 }],
        });
    });

    it('projects the default when a backward-compatible flat project omits chord-track truth', () => {
        replaceChordTrackState(undefined);

        expect(chordTrackStore.value).toEqual({ enabled: false, events: [] });
    });
});
