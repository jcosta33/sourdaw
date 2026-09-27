import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

    it('rejects an incomplete app-owned guard bundle without invoking legacy arpeggiation', () => {
        const result = handleArpeggiate.execute({
            type: 'arpeggiate',
            payload: {
                clipId: 'clip-chords',
                pattern: 'up',
                rate: 8,
                octaves: 1,
                gate: 50,
                expectedTrackId: 'track-chords',
                expectedTrackFrozen: false,
            },
        });

        expect(result).toEqual({ status: 'conflict' });
        expect(mocks.restoreMidiClipNotes).not.toHaveBeenCalled();
        expect(mocks.arpeggiate).not.toHaveBeenCalled();
    });

    it('is undoable', () => {
        expect(handleArpeggiate.undoable).toBe(true);
        expect(handleArpeggiate.requiresAbortCompensation).toBe(false);
    });
});

describe('handleArpeggiate against the real MIDI store', () => {
    const CLIP_ID = 'clip-curved-chord';

    beforeEach(() => {
        vi.resetModules();
        vi.doUnmock('#/modules/MIDI/useCases');
    });

    // This describe is the file's last suite, so no later test in this file
    // reads the module registry through the mocked barrel; leaving it
    // unmocked keeps `vi.doMock`'s partial factory from having to satisfy
    // the whole barrel's coverage.
    afterEach(() => {
        vi.resetModules();
    });

    // The extended timeout covers reloading the real, unmocked MIDI and
    // Arrangement barrels below: genuine module initialization, not
    // application work, that the default 5s budget is too tight for.
    it('admits the syncopated arpeggio inverse and returns the clip to its curved source notes', async () => {
        // Imported after the reset above so this test's stores, and the ones
        // `restoreMidiClipNotes`'s noteTransformReplayGuard check reads
        // through the freshly unmocked barrel, are the same module
        // instances; the module registry resets between tests.
        const { midiStore } = await import('#/modules/MIDI/stores');
        const { projectSyncopatedArpeggio, restoreMidiClipNotes } = await import('#/modules/MIDI/useCases');
        // Imported by relative path, not the aggregated `useCases`/`stores`
        // barrels: those re-export every file in the module, so importing
        // them here would force-load Arrangement use cases that need far
        // more of the MIDI barrel than this suite's mock provides.
        const { defaultTrackState } = await import('../../../stores/trackStore');
        const { addClip } = await import('../../../useCases/clip/addClip');
        const { createTrack } = await import('../../../useCases/createTrack');
        const { setTrackStoreState } = await import('../../../useCases/setTrackStoreState');
        const { handleArpeggiate: realHandleArpeggiate } = await import('../handleArpeggiate');

        const TRACK_ID = 'track-chords';
        setTrackStoreState({
            ...defaultTrackState,
            tracks: [createTrack({ id: TRACK_ID, kind: 'midi', name: 'Chords' })],
        });
        if (
            addClip({
                id: CLIP_ID,
                trackId: TRACK_ID,
                startBeat: 0,
                endBeat: 8,
                name: 'Chords Phrase',
                type: 'midi',
            }) === null
        ) {
            throw new Error('Expected a MIDI clip fixture');
        }

        const sourceNotes = [
            {
                id: 'c1',
                pitch: 60,
                startBeat: 0,
                duration: 2,
                velocity: 100,
                channel: 0,
                pressure: 10,
                expression: { pressure: [{ offsetBeats: 1, value: 90 }] },
            },
            { id: 'e1', pitch: 64, startBeat: 0, duration: 2, velocity: 90, channel: 0 },
        ];
        midiStore.set({ notesByClipId: { [CLIP_ID]: sourceNotes }, ccByClipId: {}, pitchBendByClipId: {} });

        const projection = projectSyncopatedArpeggio({ notes: sourceNotes });
        if (!projection) {
            throw new Error('Expected a syncopated arpeggio projection from the curved chord fixture');
        }
        const addedNotes = projection.addedNotes.map((note, index) => ({ id: `arp-${String(index)}`, ...note }));

        const action = {
            type: 'arpeggiate' as const,
            payload: {
                clipId: CLIP_ID,
                expectedTrackId: TRACK_ID,
                trackName: 'Chords',
                expectedTrackFrozen: false,
                clipName: 'Chords Phrase',
                expectedClipLocked: false,
                expectedNotes: sourceNotes,
                addedNotes,
            },
        };

        expect(realHandleArpeggiate.execute(action)).toEqual({ status: 'written' });

        const inverse = realHandleArpeggiate.describe(action).inverseAction;
        if (inverse?.type !== 'restoreMidiClipNotes') {
            throw new Error('Expected a restoreMidiClipNotes inverse action');
        }

        expect(restoreMidiClipNotes(inverse.payload)).toBe('written');
        expect(midiStore.value?.notesByClipId[CLIP_ID]).toEqual(sourceNotes);
    }, 15000);
});
