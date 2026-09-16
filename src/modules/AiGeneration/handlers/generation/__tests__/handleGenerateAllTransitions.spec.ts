import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createEventBus } from '#/infra/events/createEventBus';
import {
    defaultTrackState,
    markerStore,
    trackStore,
    type MarkerStoreState,
    type Track,
} from '#/modules/Arrangement/stores';
import { createTrack, setArrangementEventBus, setTrackStoreState } from '#/modules/Arrangement/useCases';
import { midiStore } from '#/modules/MIDI/stores';

import { handleGenerateAllTransitions } from '../handleGenerateAllTransitions';

const mocks = vi.hoisted(() => ({
    notifyUser: vi.fn<(message: string, level?: string) => void>(),
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: mocks.notifyUser,
}));

// #3765 — the handler must place real fill material at section boundaries.
// These specs seed the real marker, track and MIDI stores and assert the
// placed clip and its projected note timing.

type ArrangementTrackEvents = {
    'track.added': { trackId: string; name: string; kind: string };
    'track.removed': { trackId: string };
    'track.selectionChanged': { trackId: string | null; previousTrackId: string | null };
};

function seedSections(sections: MarkerStoreState['sections']): void {
    markerStore.set({ markers: [], sections });
}

function clipsOnTrack(trackId: string): Track['clips'] {
    return trackStore.value?.tracks.find((track) => track.id === trackId)?.clips ?? [];
}

/** The handler contract types execute's result as a widened union; this handler is a synchronous writer. */
function statusOf(
    result: ReturnType<typeof handleGenerateAllTransitions.execute>
): 'written' | 'no-write' | 'conflict' {
    if (!result || typeof result !== 'object' || !('status' in result)) {
        throw new Error('Expected a synchronous handler execution result');
    }
    return result.status;
}

describe('handleGenerateAllTransitions', () => {
    beforeEach(() => {
        mocks.notifyUser.mockClear();
        setArrangementEventBus(createEventBus<ArrangementTrackEvents>());
        midiStore.set({ probabilitySeed: 1, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        seedSections([]);
        setTrackStoreState({
            ...defaultTrackState,
            tracks: [createTrack({ id: 't-drums', name: 'Drums', kind: 'midi' })],
            selectedTrackId: 't-drums',
        });
    });

    it('places one fill clip covering both section boundaries with correct projected timing', () => {
        seedSections([
            { id: 's1', startBeat: 0, endBeat: 16, name: 'Verse', color: '#111' },
            { id: 's2', startBeat: 16, endBeat: 32, name: 'Chorus', color: '#222' },
            { id: 's3', startBeat: 32, endBeat: 48, name: 'Break', color: '#333' },
        ]);

        const result = handleGenerateAllTransitions.execute({ type: 'generateAllTransitions', payload: undefined });

        expect(statusOf(result)).toBe('written');
        const clips = clipsOnTrack('t-drums');
        expect(clips).toHaveLength(1);
        const clip = clips[0]!;
        expect(clip.name).toBe('Transition fills');

        // Boundaries land at beats 14 (Verse→Chorus) and 30 (Chorus→Break).
        const notes = midiStore.value?.notesByClipId[clip.id] ?? [];
        expect(notes.length).toBeGreaterThan(0);
        const projectedStarts = notes.map((note) => clip.startBeat + note.startBeat);
        expect(Math.min(...projectedStarts)).toBe(14);
        // Verse→Chorus routes to a 4-beat riser over [14, 18); Chorus→Break to
        // a 2-beat sweep-down over [30, 32).
        expect(Math.max(...notes.map((note) => clip.startBeat + note.startBeat + note.duration))).toBe(32);
        for (const note of notes) {
            expect(Number.isFinite(note.startBeat)).toBe(true);
            expect(note.startBeat).toBeGreaterThanOrEqual(0);
        }
        expect(mocks.notifyUser).toHaveBeenCalledWith(expect.stringContaining('Placed 2 transition fills'), 'success');
    });

    it('claims a fill for a two-section arrangement and actually places it', () => {
        seedSections([
            { id: 's1', startBeat: 0, endBeat: 16, name: 'Verse', color: '#111' },
            { id: 's2', startBeat: 16, endBeat: 32, name: 'Chorus', color: '#222' },
        ]);

        handleGenerateAllTransitions.execute({ type: 'generateAllTransitions', payload: undefined });

        const clip = clipsOnTrack('t-drums')[0]!;
        const notes = midiStore.value?.notesByClipId[clip.id] ?? [];
        // The Verse→Chorus boundary routes to a riser: 16 sixteenth steps over [14, 18).
        expect(notes).toHaveLength(16);
        expect(clip.startBeat).toBe(14);
        expect(clip.endBeat).toBe(18);
        expect(Math.min(...notes.map((note) => clip.startBeat + note.startBeat))).toBe(14);
    });

    it('refuses truthfully when there are no sections and writes nothing', () => {
        const result = handleGenerateAllTransitions.execute({ type: 'generateAllTransitions', payload: undefined });

        expect(statusOf(result)).toBe('no-write');
        expect(clipsOnTrack('t-drums')).toHaveLength(0);
        expect(mocks.notifyUser).toHaveBeenCalledWith('No section boundaries found — add sections first', 'warning');
    });

    it('refuses when every boundary falls before the project start', () => {
        seedSections([
            { id: 's1', startBeat: 0, endBeat: 1, name: 'Intro', color: '#111' },
            { id: 's2', startBeat: 1, endBeat: 17, name: 'Verse', color: '#222' },
        ]);

        const result = handleGenerateAllTransitions.execute({ type: 'generateAllTransitions', payload: undefined });

        expect(statusOf(result)).toBe('no-write');
        expect(clipsOnTrack('t-drums')).toHaveLength(0);
        expect(mocks.notifyUser).toHaveBeenCalledWith(
            'Section boundaries fall before the project start — no fills were placed',
            'warning'
        );
    });

    it('describes a guarded inverse whose clip id is the one the write creates', () => {
        seedSections([
            { id: 's1', startBeat: 0, endBeat: 16, name: 'Verse', color: '#111' },
            { id: 's2', startBeat: 16, endBeat: 32, name: 'Chorus', color: '#222' },
        ]);

        const action = { type: 'generateAllTransitions', payload: undefined } as const;
        const described = handleGenerateAllTransitions.describe(action);
        expect(described.label).toBe('Generate All Transitions');
        expect(described.inverseAction?.type).toBe('discardDuplicatedClip');

        handleGenerateAllTransitions.execute(action);

        if (described.inverseAction?.type !== 'discardDuplicatedClip') {
            throw new Error('Expected a guarded clip discard inverse');
        }
        const clip = clipsOnTrack('t-drums')[0]!;
        expect(described.inverseAction.payload.clipId).toBe(clip.id);
        expect(described.inverseAction.payload.generatedMidiStateGuard?.entityJson).toContain(clip.id);
    });

    it('is undoable', () => {
        expect(handleGenerateAllTransitions.undoable).toBe(true);
    });
});
