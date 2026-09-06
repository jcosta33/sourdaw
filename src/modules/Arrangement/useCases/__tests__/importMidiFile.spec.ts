import { beforeEach, describe, expect, it, vi } from 'vitest';

import { REDO_NOT_APPLIED } from '#/modules/Command/useCases';
import { LEGACY_MIDI_PROBABILITY_SEED } from '#/modules/MIDI/stores';
import { getMidiStoreState, setMidiStoreState } from '#/modules/MIDI/useCases';

import { TrackDummy } from '../../__tests__/TrackDummy';
import { type TrackStoreState, trackStore } from '../../stores/trackStore';
import { importMidiFile } from '../importMidiFile';

type PushUndoEntry = (label: string, undo: () => void, redo: () => unknown) => void;

type Deferred<T> = {
    promise: Promise<T>;
    reject: (reason: unknown) => void;
    resolve: (value: T) => void;
};

function createDeferred<T>(): Deferred<T> {
    let resolveDeferred!: (value: T) => void;
    let rejectDeferred!: (reason: unknown) => void;
    const promise = new Promise<T>((resolve, reject) => {
        resolveDeferred = resolve;
        rejectDeferred = reject;
    });

    return { promise, reject: rejectDeferred, resolve: resolveDeferred };
}

const mocks = vi.hoisted(() => ({
    notifyUser: vi.fn(),
    pushUndoEntry: vi.fn<PushUndoEntry>(),
    readMidiFile: vi.fn(),
    setTrackState: vi.fn<(state: TrackStoreState) => void>(),
}));

let shouldInjectConcurrentTrack = true;

vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    executeUserAppAction: vi.fn(),
    pushUndoEntry: mocks.pushUndoEntry,
}));

vi.mock('#/modules/MIDI/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/useCases')>()),
    readMidiFile: mocks.readMidiFile,
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: mocks.notifyUser,
}));

vi.mock('../setTrackState', () => ({
    setTrackState: mocks.setTrackState,
}));

const existingNote = {
    id: 'note-existing',
    pitch: 48,
    startBeat: 0,
    duration: 1,
    velocity: 100,
};

const concurrentNote = {
    id: 'note-concurrent',
    pitch: 55,
    startBeat: 1,
    duration: 1,
    velocity: 90,
};

const importedNote = {
    id: 'note-imported',
    pitch: 60,
    startBeat: 2,
    duration: 0.5,
    velocity: 110,
};

describe('importMidiFile', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        shouldInjectConcurrentTrack = true;
        trackStore.set({ tracks: [], selectedTrackId: null });
        setMidiStoreState({
            notesByClipId: { 'existing-clip': [existingNote] },
            ccByClipId: {
                'existing-clip': [{ id: 'cc-existing', controller: 1, value: 64, beat: 0, channel: 0 }],
            },
            pitchBendByClipId: {
                'existing-clip': [{ id: 'pitch-existing', value: 128, beat: 0, channel: 0 }],
            },
        });
        mocks.readMidiFile.mockResolvedValue([{ name: 'Imported', notes: [importedNote], endTick: 960 }]);
        mocks.setTrackState.mockImplementation((state: TrackStoreState) => {
            if (!shouldInjectConcurrentTrack) {
                trackStore.set(state);
                return;
            }

            shouldInjectConcurrentTrack = false;
            const importedTrack = state.tracks.find((track) => track.clips.length > 0);
            const importedClip = importedTrack?.clips[0];
            if (!importedTrack || !importedClip) {
                trackStore.set(state);
                return;
            }

            trackStore.set({
                ...state,
                tracks: [
                    ...state.tracks,
                    {
                        ...importedTrack,
                        id: 'concurrent-track',
                        name: 'Concurrent',
                        clips: [{ ...importedClip, id: 'concurrent-clip', trackId: 'concurrent-track' }],
                    },
                ],
            });
            const currentMidiState = getMidiStoreState();
            if (!currentMidiState) {
                throw new Error('Expected MIDI state while committing imported tracks');
            }
            setMidiStoreState({
                ...currentMidiState,
                notesByClipId: {
                    ...currentMidiState.notesByClipId,
                    'concurrent-clip': [concurrentNote],
                },
            });
        });
    });

    it('preserves MIDI state written between parsing and the import write', async () => {
        await importMidiFile(new File([], 'import.mid'), { shouldContinue: () => true });

        const importedClipId = trackStore.value?.tracks[0]?.clips[0]?.id;
        if (!importedClipId) {
            throw new Error('Expected the import to create a MIDI clip');
        }

        const midiState = getMidiStoreState();
        expect(trackStore.value?.tracks.some((track) => track.id === 'concurrent-track')).toBe(true);
        expect(midiState?.notesByClipId['existing-clip']).toEqual([existingNote]);
        expect(midiState?.notesByClipId['concurrent-clip']).toEqual([concurrentNote]);
        expect(midiState?.notesByClipId[importedClipId]).toEqual([importedNote]);
        expect(midiState?.ccByClipId['existing-clip']).toEqual([
            { id: 'cc-existing', controller: 1, value: 64, beat: 0, channel: 0 },
        ]);
        expect(midiState?.pitchBendByClipId['existing-clip']).toEqual([
            { id: 'pitch-existing', value: 128, beat: 0, channel: 0 },
        ]);
    });

    it('restores imported tracks and MIDI through undo and redo', async () => {
        await importMidiFile(new File([], 'import.mid'), { shouldContinue: () => true });

        const undoEntry = mocks.pushUndoEntry.mock.calls[0];
        if (!undoEntry) {
            throw new TypeError('Expected the import to register an undo entry');
        }
        const [, undo, redo] = undoEntry;

        undo();
        expect(trackStore.value?.tracks.map((track) => track.id)).toEqual(['concurrent-track']);
        expect(getMidiStoreState()).toEqual({
            probabilitySeed: LEGACY_MIDI_PROBABILITY_SEED,
            notesByClipId: {
                'existing-clip': [existingNote],
                'concurrent-clip': [concurrentNote],
            },
            ccByClipId: {
                'existing-clip': [{ id: 'cc-existing', controller: 1, value: 64, beat: 0, channel: 0 }],
            },
            pitchBendByClipId: {
                'existing-clip': [{ id: 'pitch-existing', value: 128, beat: 0, channel: 0 }],
            },
        });

        redo();
        const importedClipId = trackStore.value?.tracks.find((track) => track.id !== 'concurrent-track')?.clips[0]?.id;
        if (!importedClipId) {
            throw new Error('Expected redo to restore the imported MIDI clip');
        }
        expect(getMidiStoreState()?.notesByClipId[importedClipId]).toEqual([importedNote]);
        expect(getMidiStoreState()?.notesByClipId['concurrent-clip']).toEqual([concurrentNote]);
        expect(trackStore.value?.tracks.some((track) => track.id === 'concurrent-track')).toBe(true);
    });

    it('reports parser failures without changing stores or history', async () => {
        const trackStateBefore = trackStore.value;
        const midiStateBefore = getMidiStoreState();
        mocks.readMidiFile.mockRejectedValue(new Error('invalid MIDI'));

        await expect(importMidiFile(new File([], 'broken.mid'), { shouldContinue: () => true })).resolves.toBe(
            'completed'
        );

        expect(trackStore.value).toBe(trackStateBefore);
        expect(getMidiStoreState()).toBe(midiStateBefore);
        expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
        expect(mocks.notifyUser).toHaveBeenCalledWith(
            'Failed to import "broken.mid" - invalid or corrupt MIDI file',
            'error'
        );
    });

    it('suppresses a parser failure after the initiating project is superseded', async () => {
        const parse = createDeferred<never>();
        let isCurrent = true;
        mocks.readMidiFile.mockReturnValue(parse.promise);

        const importPromise = importMidiFile(new File([], 'stale.mid'), { shouldContinue: () => isCurrent });
        isCurrent = false;
        parse.reject(new Error('invalid MIDI'));

        await expect(importPromise).resolves.toBe('superseded');
        expect(mocks.notifyUser).not.toHaveBeenCalled();
    });

    it('commits nothing when a deferred parse is superseded by another project transition', async () => {
        const parsedTracks = [{ name: 'Imported', notes: [importedNote], endTick: 960 }];
        const parse = createDeferred<typeof parsedTracks>();
        const trackStateBefore = trackStore.value;
        const midiStateBefore = getMidiStoreState();
        let isCurrent = true;
        mocks.readMidiFile.mockReturnValue(parse.promise);

        const importPromise = importMidiFile(new File([], 'slow.mid'), {
            shouldContinue: () => isCurrent,
        });
        await vi.waitFor(() => expect(mocks.readMidiFile).toHaveBeenCalledTimes(1));

        isCurrent = false;
        parse.resolve(parsedTracks);

        await expect(importPromise).resolves.toBe('superseded');
        expect(trackStore.value).toBe(trackStateBefore);
        expect(getMidiStoreState()).toBe(midiStateBefore);
        expect(mocks.setTrackState).not.toHaveBeenCalled();
        expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
    });

    it('commits nothing when superseded immediately before the state batch', async () => {
        const trackStateBefore = trackStore.value;
        const midiStateBefore = getMidiStoreState();
        const shouldContinue = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);

        const result = await importMidiFile(new File([], 'import.mid'), { shouldContinue });

        expect(result).toBe('superseded');
        expect(trackStore.value).toBe(trackStateBefore);
        expect(getMidiStoreState()).toBe(midiStateBefore);
        expect(mocks.setTrackState).not.toHaveBeenCalled();
        expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
    });

    it('rolls back the state batch when superseded before undo registration', async () => {
        shouldInjectConcurrentTrack = false;
        const trackStateBefore = trackStore.value;
        const midiStateBefore = getMidiStoreState();
        const shouldContinue = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(true).mockReturnValue(false);

        const result = await importMidiFile(new File([], 'import.mid'), { shouldContinue });

        expect(result).toBe('superseded');
        expect(trackStore.value).toEqual(trackStateBefore);
        expect(getMidiStoreState()).toEqual(midiStateBefore);
        expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
    });

    it('rolls back MIDI when the track write fails', async () => {
        shouldInjectConcurrentTrack = false;
        const midiStateBefore = getMidiStoreState();
        mocks.setTrackState.mockImplementationOnce(() => {
            throw new Error('track write failed');
        });

        await expect(importMidiFile(new File([], 'import.mid'), { shouldContinue: () => true })).resolves.toBe(
            'completed'
        );

        expect(trackStore.value?.tracks).toEqual([]);
        expect(getMidiStoreState()).toEqual(midiStateBefore);
        expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
        expect(mocks.notifyUser).toHaveBeenCalledWith(
            'Failed to import "import.mid" - project state could not be updated',
            'error'
        );
    });

    it.each(['track', 'clip', 'alternative', 'ghost'] as const)(
        'rejects redo when an unrelated %s reuses an imported ID',
        async (kind) => {
            await importMidiFile(new File([], 'import.mid'), { shouldContinue: () => true });

            const importedTrack = trackStore.value?.tracks.find((track) => track.id !== 'concurrent-track');
            const importedClip = importedTrack?.clips[0];
            const undoEntry = mocks.pushUndoEntry.mock.calls[0];
            if (!importedTrack || !importedClip || !undoEntry) {
                throw new Error('Expected an imported track, clip, and undo entry');
            }
            const [, undo, redo] = undoEntry;
            undo();

            const collisionTrackId = kind === 'track' ? importedTrack.id : `${kind}-collision-track`;
            const collisionTrack = {
                ...importedTrack,
                id: collisionTrackId,
                name: `${kind} ID collision`,
                clips: kind === 'clip' ? [{ ...importedClip, trackId: collisionTrackId }] : [],
                alternatives:
                    kind === 'alternative'
                        ? [
                              {
                                  id: 'collision-alternative',
                                  name: 'Collision',
                                  clips: [{ ...importedClip, trackId: collisionTrackId }],
                              },
                          ]
                        : importedTrack.alternatives,
            };
            trackStore.set({
                ...trackStore.value!,
                tracks: [...(trackStore.value?.tracks ?? []), collisionTrack],
                ghostClips:
                    kind === 'ghost'
                        ? [{ ...importedClip, trackId: 'ghost-collision-track', isGhost: true }]
                        : trackStore.value?.ghostClips,
            });

            expect(redo()).toBe(REDO_NOT_APPLIED);
            expect(trackStore.value?.tracks).toContain(collisionTrack);
            expect(getMidiStoreState()?.notesByClipId[importedClip.id]).toBeUndefined();
            expect(mocks.notifyUser).toHaveBeenLastCalledWith(
                'Failed to redo MIDI import for "import.mid" - track or clip IDs now conflict',
                'error'
            );
        }
    );

    it('rejects duplicate generated identities before changing project state', async () => {
        const uuid = '00000000-0000-4000-8000-000000000000';
        const randomUuidSpy = vi.spyOn(crypto, 'randomUUID').mockReturnValue(uuid);
        mocks.readMidiFile.mockResolvedValue([
            { name: 'First', notes: [importedNote], endTick: 960 },
            { name: 'Second', notes: [concurrentNote], endTick: 960 },
        ]);
        const midiStateBefore = getMidiStoreState();

        await importMidiFile(new File([], 'duplicates.mid'), { shouldContinue: () => true });

        expect(trackStore.value?.tracks).toEqual([]);
        expect(getMidiStoreState()).toBe(midiStateBefore);
        expect(mocks.setTrackState).not.toHaveBeenCalled();
        expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
        expect(mocks.notifyUser).toHaveBeenCalledWith(
            'Failed to import "duplicates.mid" - generated track or clip IDs conflict with the project',
            'error'
        );
        randomUuidSpy.mockRestore();
    });

    it('completes without importing when the parsed MIDI has no tracks', async () => {
        shouldInjectConcurrentTrack = false;
        mocks.readMidiFile.mockResolvedValue([]);

        await expect(importMidiFile(new File([], 'empty.mid'), { shouldContinue: () => true })).resolves.toBe(
            'completed'
        );

        expect(trackStore.value?.tracks).toEqual([]);
        expect(mocks.setTrackState).not.toHaveBeenCalled();
        expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
    });

    it('rounds the clip end up to the next 4-beat bar', async () => {
        shouldInjectConcurrentTrack = false;
        // A note ending at beat 1.5 must round the clip up to beat 4 (one bar).
        mocks.readMidiFile.mockResolvedValue([{ name: 'Short', notes: [importedNote], endTick: 960 }]);

        await importMidiFile(new File([], 'short.mid'), { shouldContinue: () => true });

        const clip = trackStore.value?.tracks[0]?.clips[0];
        expect(clip?.startBeat).toBe(0);
        expect(clip?.endBeat).toBe(4);
    });

    it('extends the clip end across multiple bars when notes exceed one bar', async () => {
        shouldInjectConcurrentTrack = false;
        const longNote = { id: 'note-long', pitch: 60, startBeat: 5, duration: 2, velocity: 100 };
        mocks.readMidiFile.mockResolvedValue([{ name: 'Long', notes: [longNote], endTick: 960 }]);

        await importMidiFile(new File([], 'long.mid'), { shouldContinue: () => true });

        // startBeat 5 + duration 2 = 7; ceil(7 / 4) * 4 = 8.
        const clip = trackStore.value?.tracks[0]?.clips[0];
        expect(clip?.endBeat).toBe(8);
    });

    it('labels the undo entry with the single track name', async () => {
        shouldInjectConcurrentTrack = false;
        mocks.readMidiFile.mockResolvedValue([{ name: 'Bass', notes: [importedNote], endTick: 960 }]);

        await importMidiFile(new File([], 'bass.mid'), { shouldContinue: () => true });

        expect(mocks.pushUndoEntry.mock.calls[0]?.[0]).toBe('Import MIDI: Bass');
    });

    it('labels the undo entry with the track count when importing multiple tracks', async () => {
        shouldInjectConcurrentTrack = false;
        mocks.readMidiFile.mockResolvedValue([
            { name: 'Bass', notes: [importedNote], endTick: 960 },
            { name: 'Lead', notes: [concurrentNote], endTick: 960 },
        ]);

        await importMidiFile(new File([], 'multi.mid'), { shouldContinue: () => true });

        expect(mocks.pushUndoEntry.mock.calls[0]?.[0]).toBe('Import MIDI: 2 MIDI tracks');
    });

    it('falls back to a generic label when the single parsed track has no name', async () => {
        shouldInjectConcurrentTrack = false;
        mocks.readMidiFile.mockResolvedValue([{ name: undefined, notes: [importedNote], endTick: 960 }]);

        await importMidiFile(new File([], 'nameless.mid'), { shouldContinue: () => true });

        expect(mocks.pushUndoEntry.mock.calls[0]?.[0]).toBe('Import MIDI: MIDI file');
    });

    it('preserves an unrelated selected track when undoing the import', async () => {
        shouldInjectConcurrentTrack = false;
        const existingTrack = {
            ...TrackDummy.create({ id: 'keeper', name: 'Keeper' }),
        };
        trackStore.set({ tracks: [existingTrack], selectedTrackId: 'keeper' });

        await importMidiFile(new File([], 'import.mid'), { shouldContinue: () => true });

        const undoEntry = mocks.pushUndoEntry.mock.calls[0];
        const undo = undoEntry?.[1];
        if (!undo) {
            throw new TypeError('Expected the import to register an undo entry');
        }
        undo();

        // The imported tracks are gone, but the unrelated selection survives.
        expect(trackStore.value?.tracks.map((track) => track.id)).toEqual(['keeper']);
        expect(trackStore.value?.selectedTrackId).toBe('keeper');
    });
});
