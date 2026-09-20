import { afterEach, describe, expect, it } from 'vitest';

import { chordTrackStore, defaultChordTrackState } from '../../../stores/chordTrackStore';
import { createChordPitchProjector } from '../createChordPitchProjector';

describe('createChordPitchProjector', () => {
    afterEach(() => {
        chordTrackStore.set(defaultChordTrackState);
    });

    it('uses a supplied chord source without borrowing or changing live chords', () => {
        chordTrackStore.set(defaultChordTrackState);
        const source = {
            enabled: true,
            events: [
                { id: 'c', beat: 0, duration: 2, root: 0, quality: 'major' as const },
                { id: 'e', beat: 2, duration: 2, root: 4, quality: 'major' as const },
            ],
        };
        const project = createChordPitchProjector(source);
        source.events[1]!.root = 7;
        expect(project({ pitch: 60, referenceBeat: 0, targetBeat: 2 })).toBe(64);
        expect(chordTrackStore.value).toEqual(defaultChordTrackState);
    });

    it('keeps one immutable chord snapshot for the render lifetime', () => {
        chordTrackStore.set({
            enabled: true,
            events: [
                { id: 'c', beat: 0, duration: 2, root: 0, quality: 'major' },
                { id: 'd', beat: 2, duration: 2, root: 2, quality: 'major' },
            ],
        });
        const projectPitch = createChordPitchProjector();

        chordTrackStore.set({
            enabled: true,
            events: [
                { id: 'c', beat: 0, duration: 2, root: 0, quality: 'major' },
                { id: 'g', beat: 2, duration: 2, root: 7, quality: 'major' },
            ],
        });

        expect(projectPitch({ pitch: 60, referenceBeat: 0, targetBeat: 2 })).toBe(62);
        expect(createChordPitchProjector()({ pitch: 60, referenceBeat: 0, targetBeat: 2 })).toBe(67);
    });
});
