import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getProductionCommandHandlerMaps } from '#/app/getProductionCommandHandlerMaps';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { trackStore } from '#/modules/Arrangement/stores';
import { automationStore } from '#/modules/Automation/stores';
import { clearHandlerRegistry, macroStore, undoHistoryStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    executeAppActionBatch,
    redo,
    registerProductionCommandHandlers,
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
import { notifyUser } from '#/utils/Notification/notifyUser';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { getEnvelope, setAllEnvelopes, setEnvelope } from '../../../stores/gainEnvelopeStore';
import { warpStates } from '../../../stores/warpStates';

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

// `undo()` reports a refused inverse through `notifyUser`; the desktop
// notification bus does not exist in this environment.
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

const SOURCE_NOTE = { id: 'note-1', pitch: 60, startBeat: 0, duration: 1, velocity: 90 };

function midiClip(id: string, startBeat: number, endBeat: number) {
    const { audioBufferId: _audioBufferId, ...clip } = ClipDummy.create({ id, startBeat, endBeat, type: 'midi' });
    return clip;
}

function clipOnTrack(clipId: string) {
    return trackStore.value?.tracks[0]?.clips.find((clip) => clip.id === clipId);
}

function copyNotes(clipId: string) {
    return midiStore.value?.notesByClipId[clipId];
}

async function duplicateAt(targetClipId: string, startBeat: number) {
    await executeAppAction(
        {
            type: 'duplicateClipAt',
            payload: { clipId: 'clip-1', targetClipId, destinationTrackId: 'track-1', startBeat },
        },
        { source: 'manual' }
    );
    flushAutomergeStorageWrites();
}

/**
 * Each drift lands outside the duplicate's undo entry, as a collaborator's
 * synced edit does: a plain store write the history never recorded.
 */
const collaboratorEdits = {
    notes: () => {
        const current = midiStore.value!;
        const [note] = current.notesByClipId.copy!;
        midiStore.set({
            ...current,
            notesByClipId: { ...current.notesByClipId, copy: [{ ...note!, velocity: 42 }] },
        });
    },
    'clip fields': () => {
        const current = trackStore.value!;
        const track = current.tracks[0]!;
        trackStore.set({
            ...current,
            tracks: [
                {
                    ...track,
                    clips: track.clips.map((clip) => (clip.id === 'copy' ? { ...clip, name: 'Peer rename' } : clip)),
                },
            ],
        });
    },
    satellites: () => {
        setEnvelope('copy', {
            clipId: 'copy',
            enabled: true,
            points: [{ id: 'peer-gain', beatOffset: 0, gainDb: -12 }],
        });
    },
    'clip-scoped automation': () => {
        automationStore.set({
            lanes: [
                {
                    id: 'peer-lane',
                    trackId: 'track-1',
                    clipId: 'copy',
                    parameterId: 'gain',
                    parameterName: 'Gain',
                    points: [{ id: 'peer-point', beat: 0, value: 0.5, curve: 'linear', tension: 0 }],
                    objects: [],
                    visible: true,
                    enabled: true,
                    collapsed: false,
                    minValue: 0,
                    maxValue: 1,
                },
            ],
        });
    },
} as const;

describe('handleDuplicateClipAt undo integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('duplicate clip at undo integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerProductionCommandHandlers(getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true }));
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        setAllEnvelopes({});
        automationStore.set({ lanes: [] });
        const track = TrackDummy.create({
            id: 'track-1',
            kind: 'midi',
            clips: [midiClip('clip-1', 0, 4), midiClip('clip-2', 4, 8)],
        });
        trackStore.set({ tracks: [track], selectedTrackId: track.id, ghostClips: [] });
        midiStore.set({
            probabilitySeed: 1,
            notesByClipId: { 'clip-1': [SOURCE_NOTE], 'clip-2': [{ ...SOURCE_NOTE, id: 'note-2', pitch: 64 }] },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        flushAutomergeStorageWrites();
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        midiStore.set({ probabilitySeed: 1, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        automationStore.set({ lanes: [] });
        setAllEnvelopes({});
        warpStates.clear();
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it.each(Object.keys(collaboratorEdits) as (keyof typeof collaboratorEdits)[])(
        'keeps the copy and refuses the undo after a collaborator changes its %s',
        async (kind) => {
            await duplicateAt('copy', 8);
            expect(clipOnTrack('copy')).toBeDefined();
            expect(copyNotes('copy')).toHaveLength(1);

            collaboratorEdits[kind]();
            flushAutomergeStorageWrites();
            const copyAfterEdit = structuredClone(clipOnTrack('copy'));
            const notesAfterEdit = structuredClone(copyNotes('copy'));

            const outcome = await undo();

            expect(outcome.headConsumed).toBe(false);
            expect(notifyUser).toHaveBeenCalled();
            expect(clipOnTrack('copy')).toEqual(copyAfterEdit);
            expect(copyNotes('copy')).toEqual(notesAfterEdit);
        }
    );

    it('keeps the peer gain envelope on the refused copy', async () => {
        await duplicateAt('copy', 8);
        collaboratorEdits.satellites();
        flushAutomergeStorageWrites();

        await undo();

        expect(getEnvelope('copy')?.points).toEqual([{ id: 'peer-gain', beatOffset: 0, gainDb: -12 }]);
    });

    it('removes an unchanged copy on undo and re-creates it on redo', async () => {
        await duplicateAt('copy', 8);
        const created = structuredClone(clipOnTrack('copy'));
        expect(copyNotes('copy')).toEqual([expect.objectContaining({ pitch: 60, startBeat: 0, velocity: 90 })]);

        expect((await undo()).headConsumed).toBe(true);
        expect(clipOnTrack('copy')).toBeUndefined();
        expect(copyNotes('copy')).toBeUndefined();

        await redo();
        expect(clipOnTrack('copy')).toEqual(created);
        // The redo copies the source's notes again under freshly minted note ids.
        expect(copyNotes('copy')).toEqual([expect.objectContaining({ pitch: 60, startBeat: 0, velocity: 90 })]);

        // The guard the redo recorded describes the re-created copy, so the
        // next undo still removes it.
        expect((await undo()).headConsumed).toBe(true);
        expect(clipOnTrack('copy')).toBeUndefined();
        expect(notifyUser).not.toHaveBeenCalled();
    });

    it('still removes the copy through an inverse recorded before the guard existed', async () => {
        await duplicateAt('copy', 8);
        const entry = undoHistoryStore.value?.past.at(-1);
        if (entry?.kind !== 'action' || entry.inverseAction?.type !== 'discardDuplicatedClip') {
            throw new Error('expected the duplicate entry at the head of the undo stack');
        }
        const { generatedMidiStateGuard: _guard, ...legacyPayload } = entry.inverseAction.payload;
        entry.inverseAction.payload = legacyPayload;
        collaboratorEdits.notes();
        flushAutomergeStorageWrites();

        expect((await undo()).headConsumed).toBe(true);
        expect(clipOnTrack('copy')).toBeUndefined();
    });

    it('undoes a two-clip duplicate batch as one group', async () => {
        const result = await executeAppActionBatch(
            [
                {
                    type: 'duplicateClipAt',
                    payload: { clipId: 'clip-1', targetClipId: 'copy-1', destinationTrackId: 'track-1', startBeat: 8 },
                },
                {
                    type: 'duplicateClipAt',
                    payload: { clipId: 'clip-2', targetClipId: 'copy-2', destinationTrackId: 'track-1', startBeat: 12 },
                },
            ],
            { groupId: 'duplicate-clips-forward-test', groupLabel: 'Duplicate 2 clips forward', source: 'manual' }
        );
        flushAutomergeStorageWrites();
        expect(result.status, result.status === 'rejected' ? result.reason : undefined).toBe('committed');
        expect(clipOnTrack('copy-1')).toBeDefined();
        expect(clipOnTrack('copy-2')).toBeDefined();

        expect((await undo()).headConsumed).toBe(true);

        expect(clipOnTrack('copy-1')).toBeUndefined();
        expect(clipOnTrack('copy-2')).toBeUndefined();
        expect(trackStore.value?.tracks[0]?.clips.map((clip) => clip.id)).toEqual(['clip-1', 'clip-2']);
        expect(notifyUser).not.toHaveBeenCalled();
    });
});
