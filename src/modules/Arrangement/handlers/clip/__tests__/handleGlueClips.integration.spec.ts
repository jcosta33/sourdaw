import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { automationStore } from '#/modules/Automation/stores';
import { clearHandlerRegistry, macroStore, registerHandlerMap } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppActionBatch,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { midiStore } from '#/modules/MIDI/stores';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { trackStore } from '../../../stores/trackStore';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

describe('handleGlueClips atomic integration', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('glue clips atomic integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        const first = ClipDummy.create({
            id: 'clip-a',
            trackId: 'track-midi',
            name: 'Intro A',
            type: 'midi',
            startBeat: 8,
            endBeat: 12,
            midiOffsetBeats: 2,
        });
        const second = ClipDummy.create({
            id: 'clip-b',
            trackId: 'track-midi',
            name: 'Intro B',
            type: 'midi',
            startBeat: 12,
            endBeat: 16,
            midiOffsetBeats: 1,
        });
        const track = TrackDummy.create({ id: 'track-midi', kind: 'midi', clips: [first, second] });
        trackStore.set({ tracks: [track], selectedTrackId: track.id, ghostClips: [] });
        midiStore.set({
            notesByClipId: {
                'clip-a': [{ id: 'note-a', pitch: 60, startBeat: 3, duration: 1, velocity: 100 }],
                'clip-b': [{ id: 'note-b', pitch: 64, startBeat: 2, duration: 1, velocity: 100 }],
            },
            ccByClipId: {
                'clip-a': [{ id: 'cc-a', controller: 1, value: 0.25, beat: 3, channel: 0 }],
            },
            pitchBendByClipId: {
                'clip-b': [{ id: 'bend-b', value: 0.25, beat: 3, channel: 0 }],
            },
            migratedAbsoluteNoteClipIds: ['clip-a', 'clip-b'],
        });
        automationStore.set({ lanes: [] });
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        midiStore.set({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        automationStore.set({ lanes: [] });
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('round-trips clips, MIDI rows, migration ownership, and target identity through undo and redo', async () => {
        const originalClips = structuredClone(trackStore.value!.tracks[0]!.clips);
        const originalMidi = structuredClone(midiStore.value!);

        const result = await executeAppActionBatch(
            [{ type: 'glueClips', payload: { clipIds: ['clip-a', 'clip-b'] } }],
            { source: 'prompt', requireCompensation: true }
        );

        expect(result).toMatchObject({ status: 'committed' });
        const glued = trackStore.value!.tracks[0]!.clips[0]!;
        expect(glued).toMatchObject({ name: 'Intro A (glued)', startBeat: 8, endBeat: 16, type: 'midi' });
        expect(midiStore.value!.notesByClipId[glued.id]).toMatchObject([
            { id: 'note-a', startBeat: 1 },
            { id: 'note-b', startBeat: 5 },
        ]);
        expect(midiStore.value!.ccByClipId[glued.id]).toMatchObject([{ id: 'cc-a', beat: 1 }]);
        expect(midiStore.value!.pitchBendByClipId[glued.id]).toMatchObject([{ id: 'bend-b', beat: 6 }]);
        expect(midiStore.value!.migratedAbsoluteNoteClipIds).toEqual([glued.id]);

        await undo();
        expect(trackStore.value!.tracks[0]!.clips).toEqual(originalClips);
        expect(midiStore.value).toEqual(originalMidi);

        await redo();
        expect(trackStore.value!.tracks[0]!.clips).toMatchObject([{ id: glued.id, name: 'Intro A (glued)' }]);
        expect(midiStore.value!.notesByClipId[glued.id]).toMatchObject([
            { id: 'note-a', startBeat: 1 },
            { id: 'note-b', startBeat: 5 },
        ]);
        expect(midiStore.value!.migratedAbsoluteNoteClipIds).toEqual([glued.id]);
    });

    it('keeps the glue and undo entry when the target gains clip automation', async () => {
        await executeAppActionBatch([{ type: 'glueClips', payload: { clipIds: ['clip-a', 'clip-b'] } }], {
            source: 'prompt',
            requireCompensation: true,
        });
        const glued = trackStore.value!.tracks[0]!.clips[0]!;
        automationStore.set({
            lanes: [
                {
                    id: 'lane-glued-gain',
                    trackId: 'track-midi',
                    clipId: glued.id,
                    parameterId: 'gain',
                    parameterName: 'Gain',
                    points: [{ id: 'point-a', beat: 9, value: 0.5, curve: 'linear', tension: 0.5 }],
                    objects: [],
                    visible: true,
                    enabled: true,
                    collapsed: false,
                    minValue: 0,
                    maxValue: 1,
                },
            ],
        });

        await undo();

        expect(trackStore.value!.tracks[0]!.clips).toMatchObject([{ id: glued.id }]);
        expect(automationStore.value!.lanes).toMatchObject([{ clipId: glued.id }]);

        automationStore.set({ lanes: [] });
        await undo();
        expect(trackStore.value!.tracks[0]!.clips).toMatchObject([{ id: 'clip-a' }, { id: 'clip-b' }]);
    });

    it('keeps the glue and undo entry when a ghost clip links to the target', async () => {
        await executeAppActionBatch([{ type: 'glueClips', payload: { clipIds: ['clip-a', 'clip-b'] } }], {
            source: 'prompt',
            requireCompensation: true,
        });
        const glued = trackStore.value!.tracks[0]!.clips[0]!;
        const ghost = ClipDummy.create({
            id: 'clip-ghost',
            trackId: 'track-midi',
            type: 'midi',
            parentClipId: glued.id,
            isGhost: true,
        });
        trackStore.set({ ...trackStore.value!, ghostClips: [ghost] });

        await undo();

        expect(trackStore.value!.tracks[0]!.clips).toMatchObject([{ id: glued.id }]);
        expect(trackStore.value!.ghostClips).toMatchObject([{ id: 'clip-ghost', parentClipId: glued.id }]);

        trackStore.set({ ...trackStore.value!, ghostClips: [] });
        await undo();
        expect(trackStore.value!.tracks[0]!.clips).toMatchObject([{ id: 'clip-a' }, { id: 'clip-b' }]);
    });

    it('preserves unrelated clip and migration edits through undo and redo', async () => {
        await executeAppActionBatch([{ type: 'glueClips', payload: { clipIds: ['clip-a', 'clip-b'] } }], {
            source: 'prompt',
            requireCompensation: true,
        });
        const glued = trackStore.value!.tracks[0]!.clips[0]!;
        const unrelated = ClipDummy.create({
            id: 'clip-unrelated',
            trackId: 'track-midi',
            name: 'Later edit',
            type: 'midi',
            startBeat: 20,
            endBeat: 24,
        });
        trackStore.set({
            ...trackStore.value!,
            tracks: trackStore.value!.tracks.map((track) =>
                track.id === 'track-midi' ? { ...track, clips: [...track.clips, unrelated] } : track
            ),
        });
        midiStore.set({
            ...midiStore.value!,
            notesByClipId: {
                ...midiStore.value!.notesByClipId,
                'clip-unrelated': [{ id: 'note-unrelated', pitch: 72, startBeat: 0, duration: 1, velocity: 100 }],
            },
            migratedAbsoluteNoteClipIds: [...(midiStore.value!.migratedAbsoluteNoteClipIds ?? []), 'clip-unrelated'],
        });

        await undo();
        expect(trackStore.value!.tracks[0]!.clips).toMatchObject([
            { id: 'clip-a' },
            { id: 'clip-b' },
            { id: 'clip-unrelated', name: 'Later edit' },
        ]);
        expect(midiStore.value!.notesByClipId['clip-unrelated']).toMatchObject([{ id: 'note-unrelated' }]);
        expect(midiStore.value!.migratedAbsoluteNoteClipIds).toEqual(['clip-a', 'clip-b', 'clip-unrelated']);

        await redo();
        expect(trackStore.value!.tracks[0]!.clips).toMatchObject([
            { id: glued.id },
            { id: 'clip-unrelated', name: 'Later edit' },
        ]);
        expect(midiStore.value!.notesByClipId['clip-unrelated']).toMatchObject([{ id: 'note-unrelated' }]);
        expect(midiStore.value!.migratedAbsoluteNoteClipIds).toEqual([glued.id, 'clip-unrelated']);
    });

    it('round-trips interleaved migration markers exactly', async () => {
        midiStore.set({
            ...midiStore.value!,
            migratedAbsoluteNoteClipIds: ['unrelated-1', 'clip-a', 'unrelated-2', 'clip-b', 'unrelated-3'],
        });

        await executeAppActionBatch([{ type: 'glueClips', payload: { clipIds: ['clip-a', 'clip-b'] } }], {
            source: 'prompt',
            requireCompensation: true,
        });
        const glued = trackStore.value!.tracks[0]!.clips[0]!;
        expect(midiStore.value!.migratedAbsoluteNoteClipIds).toEqual([
            'unrelated-1',
            glued.id,
            'unrelated-2',
            'unrelated-3',
        ]);

        await undo();
        expect(midiStore.value!.migratedAbsoluteNoteClipIds).toEqual([
            'unrelated-1',
            'clip-a',
            'unrelated-2',
            'clip-b',
            'unrelated-3',
        ]);

        await redo();
        expect(midiStore.value!.migratedAbsoluteNoteClipIds).toEqual([
            'unrelated-1',
            glued.id,
            'unrelated-2',
            'unrelated-3',
        ]);
    });

    it('preserves a concurrent present-empty migration-list edit', async () => {
        midiStore.set({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        await executeAppActionBatch([{ type: 'glueClips', payload: { clipIds: ['clip-a', 'clip-b'] } }], {
            source: 'prompt',
            requireCompensation: true,
        });
        midiStore.set({ ...midiStore.value!, migratedAbsoluteNoteClipIds: [] });

        await undo();

        expect(midiStore.value).toHaveProperty('migratedAbsoluteNoteClipIds', []);
        expect(trackStore.value!.tracks[0]!.clips).toMatchObject([{ id: 'clip-a' }, { id: 'clip-b' }]);
    });

    it('keeps concurrent insertions on both sides of the glued placeholder', async () => {
        await executeAppActionBatch([{ type: 'glueClips', payload: { clipIds: ['clip-a', 'clip-b'] } }], {
            source: 'prompt',
            requireCompensation: true,
        });
        const glued = trackStore.value!.tracks[0]!.clips[0]!;
        const before = ClipDummy.create({
            id: 'clip-before',
            trackId: 'track-midi',
            name: 'Before',
            type: 'midi',
            startBeat: 0,
            endBeat: 4,
        });
        const after = ClipDummy.create({
            id: 'clip-after',
            trackId: 'track-midi',
            name: 'After',
            type: 'midi',
            startBeat: 20,
            endBeat: 24,
        });
        trackStore.set({
            ...trackStore.value!,
            tracks: trackStore.value!.tracks.map((track) =>
                track.id === 'track-midi' ? { ...track, clips: [before, glued, after] } : track
            ),
        });
        midiStore.set({
            ...midiStore.value!,
            migratedAbsoluteNoteClipIds: ['clip-before', glued.id, 'clip-after'],
        });

        await undo();
        expect(trackStore.value!.tracks[0]!.clips).toMatchObject([
            { id: 'clip-before' },
            { id: 'clip-a' },
            { id: 'clip-b' },
            { id: 'clip-after' },
        ]);
        expect(midiStore.value!.migratedAbsoluteNoteClipIds).toEqual(['clip-before', 'clip-a', 'clip-b', 'clip-after']);

        await redo();
        expect(trackStore.value!.tracks[0]!.clips).toMatchObject([
            { id: 'clip-before' },
            { id: glued.id },
            { id: 'clip-after' },
        ]);
        expect(midiStore.value!.migratedAbsoluteNoteClipIds).toEqual(['clip-before', glued.id, 'clip-after']);
    });
});
