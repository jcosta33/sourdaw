import { describe, expect, it } from 'vitest';

import { type ChordTrackState } from '../../models/ChordTrackState';
import { projectChordTrackAction } from '../projectChordTrackAction';

const HELD_BEAT: ChordTrackState = {
    enabled: true,
    events: [{ id: 'chord-m', beat: 4, root: 0, quality: 'major', duration: 4 }],
};

describe('projectChordTrackAction ordering', () => {
    it('orders a chord added on a held beat by id, as a reload does, not by arrival', () => {
        const projected = projectChordTrackAction(HELD_BEAT, {
            type: 'addChordEvent',
            payload: { beat: 4, root: 7, quality: 'major', duration: 4, eventId: 'chord-a' },
        });

        expect(projected.events.map((event) => event.id)).toEqual(['chord-a', 'chord-m']);
    });

    it('orders a chord moved onto a held beat by id', () => {
        const state: ChordTrackState = {
            enabled: true,
            events: [...HELD_BEAT.events, { id: 'chord-a', beat: 8, root: 7, quality: 'major', duration: 4 }],
        };
        const projected = projectChordTrackAction(state, {
            type: 'moveChordEvent',
            payload: { eventId: 'chord-a', beat: 4 },
        });

        expect(projected.events.map((event) => event.id)).toEqual(['chord-a', 'chord-m']);
    });
});
