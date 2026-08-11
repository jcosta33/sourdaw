import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleArpeggiate } from '../handleArpeggiate';

const mocks = vi.hoisted(() => ({
    arpeggiate: vi.fn(),
    restoreMidiClipNotes: vi.fn(() => 'written' as const),
}));

vi.mock('#/modules/MIDI/useCases', () => ({
    arpeggiate: mocks.arpeggiate,
    restoreMidiClipNotes: mocks.restoreMidiClipNotes,
}));

describe('handleArpeggiate', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes arpeggiate with the provided payload', () => {
        void handleArpeggiate.execute({
            type: 'arpeggiate',
            payload: {
                clipId: 'c1',
                pattern: 'down',
                rate: 8,
                octaves: 2,
                gate: 50,
            },
        });

        expect(mocks.arpeggiate).toHaveBeenCalledWith('c1', 'down', 8, 2, 50);
    });

    it('uses defaults for missing parameters', () => {
        void handleArpeggiate.execute({
            type: 'arpeggiate',
            payload: {
                clipId: 'c1',
            },
        });

        expect(mocks.arpeggiate).toHaveBeenCalledWith('c1', 'up', 16, 1, 80);
    });

    it('provides a description based on pattern', () => {
        const desc1 = handleArpeggiate.describe({
            type: 'arpeggiate',
            payload: { clipId: 'c1', pattern: 'random' },
        });
        expect(desc1.label).toBe('Arpeggiate (random)');

        const desc2 = handleArpeggiate.describe({
            type: 'arpeggiate',
            payload: { clipId: 'c1' },
        });
        expect(desc2.label).toBe('Arpeggiate (up)');
    });

    it('executes and describes the app-guarded syncopated addition through exact MIDI snapshots', () => {
        const expectedNotes = [{ id: 'source', pitch: 60, startBeat: 0, duration: 2, velocity: 100, channel: 0 }];
        const addedNotes = [{ id: 'arp-1', pitch: 60, startBeat: 0.25, duration: 0.25, velocity: 100, channel: 0 }];
        const action = {
            type: 'arpeggiate' as const,
            payload: {
                clipId: 'clip-chords',
                pattern: 'up',
                rate: 8,
                octaves: 1,
                gate: 50,
                expectedTrackId: 'track-chords',
                trackName: 'Chords',
                expectedTrackFrozen: false,
                clipName: 'Chords Phrase',
                expectedClipLocked: false,
                expectedNotes,
                addedNotes,
            },
        };

        expect(handleArpeggiate.execute(action)).toEqual({ status: 'written' });
        expect(mocks.restoreMidiClipNotes).toHaveBeenCalledWith({
            clipId: 'clip-chords',
            notes: [...expectedNotes, ...addedNotes],
            expectedNotes,
            noteTransformReplayGuard: {
                trackId: 'track-chords',
                expectedTrackFrozen: false,
                expectedClipLocked: false,
            },
        });
        expect(mocks.arpeggiate).not.toHaveBeenCalled();
        expect(handleArpeggiate.describe(action)).toEqual({
            label: 'Track "Chords" (track-chords), clip "Chords Phrase" (clip-chords): add 1 syncopated offbeat eighth-note arpeggio notes; preserve 1 source notes, absolute voicing, velocities, expression, and harmonic boundaries',
            inverseAction: {
                type: 'restoreMidiClipNotes',
                payload: {
                    clipId: 'clip-chords',
                    notes: expectedNotes,
                    expectedNotes: [...expectedNotes, ...addedNotes],
                    noteTransformReplayGuard: {
                        trackId: 'track-chords',
                        expectedTrackFrozen: false,
                        expectedClipLocked: false,
                    },
                },
            },
            redoAction: {
                type: 'restoreMidiClipNotes',
                payload: {
                    clipId: 'clip-chords',
                    notes: [...expectedNotes, ...addedNotes],
                    expectedNotes,
                    noteTransformReplayGuard: {
                        trackId: 'track-chords',
                        expectedTrackFrozen: false,
                        expectedClipLocked: false,
                    },
                },
            },
        });
    });

    it('keeps the app-owned guard path when valid display names are empty', () => {
        const expectedNotes = [{ id: 'source', pitch: 60, startBeat: 0, duration: 2, velocity: 100, channel: 0 }];
        const addedNotes = [{ id: 'arp-1', pitch: 60, startBeat: 0.25, duration: 0.25, velocity: 100, channel: 0 }];
        const action = {
            type: 'arpeggiate' as const,
            payload: {
                clipId: 'clip-chords',
                pattern: 'up',
                rate: 8,
                octaves: 1,
                gate: 50,
                expectedTrackId: 'track-chords',
                trackName: '',
                expectedTrackFrozen: false,
                clipName: '',
                expectedClipLocked: false,
                expectedNotes,
                addedNotes,
            },
        };

        expect(handleArpeggiate.execute(action)).toEqual({ status: 'written' });
        expect(mocks.restoreMidiClipNotes).toHaveBeenCalledWith({
            clipId: 'clip-chords',
            notes: [...expectedNotes, ...addedNotes],
            expectedNotes,
            noteTransformReplayGuard: {
                trackId: 'track-chords',
                expectedTrackFrozen: false,
                expectedClipLocked: false,
            },
        });
        expect(mocks.arpeggiate).not.toHaveBeenCalled();
        expect(handleArpeggiate.describe(action).label).toContain('Track "" (track-chords), clip "" (clip-chords)');
    });

    it('is undoable', () => {
        expect(handleArpeggiate.undoable).toBe(true);
        expect(handleArpeggiate.requiresAbortCompensation).toBe(false);
    });
});
