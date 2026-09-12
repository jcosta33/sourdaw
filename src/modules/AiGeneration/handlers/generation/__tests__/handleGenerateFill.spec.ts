import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createEventBus } from '#/infra/events/createEventBus';
import { defaultTrackState, trackStore, type Track } from '#/modules/Arrangement/stores';
import { createTrack, setArrangementEventBus, setTrackStoreState } from '#/modules/Arrangement/useCases';
import { midiStore } from '#/modules/MIDI/stores';

import { handleGenerateFill } from '../handleGenerateFill';

const mocks = vi.hoisted(() => ({
    notifyUser: vi.fn<(message: string, level?: string) => void>(),
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: mocks.notifyUser,
}));

// #3765 — these specs run the real handler against the real track and MIDI
// stores: the acceptance is placed clip/note state with correct projected
// timing, not the notification text.

type ArrangementTrackEvents = {
    'track.added': { trackId: string; name: string; kind: string };
    'track.removed': { trackId: string };
    'track.selectionChanged': { trackId: string | null; previousTrackId: string | null };
};

function midiTrack(id: string, name: string): Track {
    return createTrack({ id, name, kind: 'midi' });
}

function seedTracks(options: { tracks: Track[]; selectedTrackId?: string }): void {
    setTrackStoreState({
        ...defaultTrackState,
        tracks: options.tracks,
        selectedTrackId: options.selectedTrackId ?? null,
    });
}

function clipsOnTrack(trackId: string): Track['clips'] {
    return trackStore.value?.tracks.find((track) => track.id === trackId)?.clips ?? [];
}

function notesFor(clipId: string): NonNullable<typeof midiStore.value>['notesByClipId'][string] {
    return midiStore.value?.notesByClipId[clipId] ?? [];
}

/** The handler contract types execute's result as a widened union; these handlers are synchronous writers. */
function statusOf(result: ReturnType<typeof handleGenerateFill.execute>): 'written' | 'no-write' | 'conflict' {
    if (!result || typeof result !== 'object' || !('status' in result)) {
        throw new Error('Expected a synchronous handler execution result');
    }
    return result.status;
}

describe('handleGenerateFill', () => {
    beforeEach(() => {
        mocks.notifyUser.mockClear();
        setArrangementEventBus(createEventBus<ArrangementTrackEvents>());
        midiStore.set({ probabilitySeed: 1, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        seedTracks({ tracks: [] });
    });

    it('places the generated fill as a clip with notes on the drum-named track', () => {
        seedTracks({ tracks: [midiTrack('t-bass', 'Bass'), midiTrack('t-drums', 'Drums')] });

        const result = handleGenerateFill.execute({
            type: 'generateFill',
            payload: { atBeat: 14, durationBeats: 2, style: 'descending' },
        });

        expect(statusOf(result)).toBe('written');
        const clips = clipsOnTrack('t-drums');
        expect(clips).toHaveLength(1);
        const clip = clips[0]!;
        // The fill spans [atBeat, atBeat + durationBeats) and the closing
        // crash lands one more beat later, on the next section's downbeat.
        expect(clip.name).toBe('Fill (descending)');
        expect(clip.startBeat).toBe(14);
        expect(clip.endBeat).toBe(17);

        const notes = notesFor(clip.id);
        // Two bars × four descending toms plus the closing crash.
        expect(notes).toHaveLength(9);
        const projected = notes.map((note) => clip.startBeat + note.startBeat);
        expect(Math.min(...projected)).toBe(14);
        expect(notes.at(-1)?.pitch).toBe(49);
        expect(projected.at(-1)).toBe(16);
        for (const note of notes) {
            expect(note.startBeat).toBeGreaterThanOrEqual(0);
            expect(note.startBeat + note.duration).toBeLessThanOrEqual(3);
        }
        expect(mocks.notifyUser).toHaveBeenCalledWith(`Placed 9-note drum fill on "Drums" at beat 14`, 'success');
    });

    it('prefers the drum-named track over the selected track', () => {
        seedTracks({
            tracks: [midiTrack('t-bass', 'Bass'), midiTrack('t-drums', 'Drums 2')],
            selectedTrackId: 't-bass',
        });

        handleGenerateFill.execute({ type: 'generateFill', payload: { atBeat: 8 } });

        expect(clipsOnTrack('t-drums')).toHaveLength(1);
        expect(clipsOnTrack('t-bass')).toHaveLength(0);
    });

    it('falls back to the selected MIDI track when none is drum-named', () => {
        seedTracks({
            tracks: [midiTrack('t-keys', 'Keys'), midiTrack('t-bass', 'Bass')],
            selectedTrackId: 't-bass',
        });

        handleGenerateFill.execute({ type: 'generateFill', payload: { atBeat: 4 } });

        expect(clipsOnTrack('t-bass')).toHaveLength(1);
        expect(clipsOnTrack('t-keys')).toHaveLength(0);
    });

    it('creates a Drums track when no MIDI track exists, instead of faking success', () => {
        seedTracks({ tracks: [] });

        const result = handleGenerateFill.execute({ type: 'generateFill', payload: { atBeat: 0 } });

        expect(statusOf(result)).toBe('written');
        const created = trackStore.value?.tracks.find((track) => track.name === 'Drums');
        expect(created?.kind).toBe('midi');
        expect(created?.clips).toHaveLength(1);
    });

    it('refuses an invalid placement beat without writing anything', () => {
        seedTracks({ tracks: [midiTrack('t-drums', 'Drums')] });

        const result = handleGenerateFill.execute({ type: 'generateFill', payload: { atBeat: -4 } });

        expect(statusOf(result)).toBe('no-write');
        expect(clipsOnTrack('t-drums')).toHaveLength(0);
        expect(mocks.notifyUser).toHaveBeenCalledWith(expect.stringContaining('invalid'), 'error');
    });

    it('describes a guarded inverse whose clip id is the one the write creates', () => {
        seedTracks({ tracks: [midiTrack('t-drums', 'Drums')] });

        const action = { type: 'generateFill', payload: { atBeat: 8 } } as const;
        const described = handleGenerateFill.describe(action);
        expect(described.label).toBe('Generate Fill');
        expect(described.inverseAction?.type).toBe('discardDuplicatedClip');

        handleGenerateFill.execute(action);

        if (described.inverseAction?.type !== 'discardDuplicatedClip') {
            throw new Error('Expected a guarded clip discard inverse');
        }
        const clip = clipsOnTrack('t-drums')[0]!;
        expect(described.inverseAction.payload.clipId).toBe(clip.id);
        const guard = described.inverseAction.payload.generatedMidiStateGuard;
        expect(guard?.entityJson).toContain(clip.id);
        expect(guard?.midiByClipIdJson).toContain('"pitch"');
    });

    it('is undoable', () => {
        expect(handleGenerateFill.undoable).toBe(true);
    });
});
