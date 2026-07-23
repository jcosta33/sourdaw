import { afterEach, describe, expect, it } from 'vitest';

import { chordTrackStore, defaultChordTrackState } from '../../../stores/chordTrackStore';
import { createChordPitchProjector } from '../createChordPitchProjector';

describe('createChordPitchProjector', () => {
    afterEach(() => {
        chordTrackStore.set(defaultChordTrackState);
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
