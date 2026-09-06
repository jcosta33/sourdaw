import { change, clone, merge, type Doc } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Container } from '#/infra/di/Container';
import { createEventBus } from '#/infra/events/createEventBus';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, macroStore, registerHandlerMap } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import { type ActionHistoryState } from '#/modules/CrdtDocument/stores';
import {
    clearActionHistory,
    createCrdtDoc,
    getCrdtDoc,
    markActionHistoryEntryReverted,
    projectCrdtToStores,
    recordActionHistoryEntries,
    recordActionHistoryEntry,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    replaceCrdtDocInLineage,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';

import { ClipDummy } from '../../__tests__/ClipDummy';
import { TrackDummy } from '../../__tests__/TrackDummy';
import { type Track } from '../../models/Track';
import { trackStore, type TrackStoreState } from '../../stores/trackStore';
import { ArrangementEventBus, setArrangementEventBus } from '../arrangementEventBus';
import { getArrangementHandlers } from '../getArrangementHandlers';
import { importAudioFile } from '../importAudioFile';

const mocks = vi.hoisted(() => ({
    decodeAudioFile: vi.fn(),
    discardDecodedAudioFile: vi.fn(),
    getAssetTransfer: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    decodeAudioFile: mocks.decodeAudioFile,
    discardDecodedAudioFile: mocks.discardDecodedAudioFile,
}));

vi.mock('#/modules/Collaboration/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Collaboration/useCases')>()),
    getAssetTransfer: mocks.getAssetTransfer,
}));

type NotificationEvents = {
    'ui.notify': NotifyPayload;
    'ui.confirm': ConfirmPayload;
    'ui.prompt': PromptPayload;
};

type RootProjectDocument = { tracks?: TrackStoreState; actionHistory?: ActionHistoryState };

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

class NoopArrangementEventBus extends ArrangementEventBus {
    async emit(): Promise<void> {}
}

let notifications: NotifyPayload[] = [];
let unsubscribeFromNotifications: () => void = () => undefined;

function requireRootDocument(): Doc<RootProjectDocument> {
    const document = getCrdtDoc<RootProjectDocument>('root');
    if (!document) {
        throw new Error('Expected root CRDT document');
    }
    return document;
}

function requireAuthoritativeTrackState(): TrackStoreState {
    const state = requireRootDocument().tracks;
    if (!state) {
        throw new Error('Expected authoritative track state');
    }
    return structuredClone(state);
}

function requireProjectedTrackState(): TrackStoreState {
    const state = trackStore.value;
    if (!state) {
        throw new Error('Expected projected track state');
    }
    return state;
}

function requireActionHistory(): ActionHistoryState {
    const history = requireRootDocument().actionHistory;
    if (!history) {
        throw new Error('Expected authoritative action history');
    }
    return structuredClone(history);
}

function mergePeerTrackEdit(edit: (tracks: Track[]) => void): void {
    const local = requireRootDocument();
    const peer = change(clone(local), (draft) => {
        if (!draft.tracks) {
            throw new Error('Expected peer track state');
        }
        edit(draft.tracks.tracks);
    });
    replaceCrdtDocInLineage({ id: 'root', doc: merge(clone(local), peer) });
    projectCrdtToStores();
}

function expectTrackStateMatchesDocument(): void {
    expect(requireProjectedTrackState().tracks).toEqual(requireAuthoritativeTrackState().tracks);
}

async function expectPeerImportEditToConflict(edit: (track: Track) => void): Promise<void> {
    await expect(importAudioFile(new File([], 'loop.wav'), { shouldContinue: () => true })).resolves.toBe('completed');
    flushAutomergeStorageWrites();
    const importedTrack = requireProjectedTrackState().tracks.find((track) => track.id !== 'track-original');
    if (!importedTrack || !importedTrack.clips[0]) {
        throw new Error('Expected imported track and clip');
    }

    mergePeerTrackEdit((tracks) => {
        const imported = tracks.find((track) => track.id === importedTrack.id);
        if (!imported) {
            throw new Error('Expected imported peer track');
        }
        edit(imported);
    });

    const authoritativeBeforeUndo = requireAuthoritativeTrackState();
    const projectionBeforeUndo = structuredClone(requireProjectedTrackState());
    const historyBeforeUndo = requireActionHistory();
    expect(historyBeforeUndo.entries.map((entry) => entry.groupLabel)).toEqual([
        'Import audio: loop',
        'Import audio: loop',
    ]);

    expect(await undo()).toEqual({ headConsumed: false });
    flushAutomergeStorageWrites();

    expect(requireAuthoritativeTrackState()).toEqual(authoritativeBeforeUndo);
    expect(requireProjectedTrackState()).toEqual(projectionBeforeUndo);
    expect(requireActionHistory()).toEqual(historyBeforeUndo);
    expect(notifications).toEqual([
        {
            message: 'Cannot undo "Import audio: loop": project state has changed',
            level: 'warning',
        },
    ]);

    expect(await undo()).toEqual({ headConsumed: false });
    flushAutomergeStorageWrites();
    expect(requireAuthoritativeTrackState()).toEqual(authoritativeBeforeUndo);
    expect(requireProjectedTrackState()).toEqual(projectionBeforeUndo);
    expect(requireActionHistory()).toEqual(historyBeforeUndo);
    expect(notifications).toHaveLength(2);
    expect(notifications[1]).toEqual(notifications[0]);
}

describe('importAudioFile semantic undo integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.decodeAudioFile.mockResolvedValue({
            id: 'buffer-imported',
            buffer: { duration: 1 } as AudioBuffer,
        });
        mocks.getAssetTransfer.mockReturnValue(null);

        Container.clear();
        setArrangementEventBus(new NoopArrangementEventBus());
        const notificationEventBus = createEventBus<NotificationEvents>();
        notifications = [];
        unsubscribeFromNotifications = notificationEventBus.on('ui.notify', (notification) => {
            notifications.push(notification);
        });
        setNotificationEventBus(notificationEventBus);

        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('audio import semantic undo integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        setActionHistoryMetadataPort({
            record: recordActionHistoryEntry,
            recordBatch: recordActionHistoryEntries,
            markReverted: markActionHistoryEntryReverted,
            clear: clearActionHistory,
        });
        clearUndoHistory();
        resetActionReplayAuthority();
        macroStore.set({ macros: [], recording: false, currentRecording: [] });

        const original = TrackDummy.create({
            id: 'track-original',
            name: 'Before',
            clips: [],
            activeAlternativeId: 'alternative-original',
            alternatives: [{ id: 'alternative-original', name: 'Alternative 1', clips: [] }],
        });
        trackStore.set({ tracks: [original], selectedTrackId: original.id, ghostClips: [] });
        flushAutomergeStorageWrites();
    });

    afterEach(() => {
        clearUndoHistory();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        resetActionReplayAuthority();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        flushAutomergeStorageWrites();
        unsubscribeFromNotifications();
        unsubscribeFromNotifications = () => undefined;
        Container.clear();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('preserves peer edits through real undo and redo while restoring the same imported identities', async () => {
        await expect(importAudioFile(new File([], 'loop.wav'), { shouldContinue: () => true })).resolves.toBe(
            'completed'
        );
        flushAutomergeStorageWrites();

        const importedTrack = requireProjectedTrackState().tracks.find((track) => track.id !== 'track-original');
        expect(importedTrack).toBeDefined();
        const importedClip = importedTrack?.clips[0];
        expect(importedClip).toBeDefined();
        const importedTrackId = importedTrack!.id;
        const importedClipId = importedClip!.id;

        mergePeerTrackEdit((tracks) => {
            const original = tracks.find((track) => track.id === 'track-original');
            if (!original) {
                throw new Error('Expected original track');
            }
            original.name = 'Remote rename';
            tracks.push(TrackDummy.create({ id: 'track-remote', name: 'Remote track', clips: [] }));
        });

        expect(await undo()).toEqual({ headConsumed: true });
        flushAutomergeStorageWrites();
        expect(notifications).toEqual([]);
        expectTrackStateMatchesDocument();
        expect(requireProjectedTrackState().tracks.map((track) => track.id)).toEqual([
            'track-original',
            'track-remote',
        ]);
        expect(requireProjectedTrackState().tracks[0]?.name).toBe('Remote rename');

        mergePeerTrackEdit((tracks) => {
            tracks.push(TrackDummy.create({ id: 'track-after-undo', name: 'After undo', clips: [] }));
        });

        await redo();
        flushAutomergeStorageWrites();

        expect(notifications).toEqual([]);
        expectTrackStateMatchesDocument();
        expect(requireProjectedTrackState().tracks.map((track) => track.id)).toEqual([
            'track-original',
            'track-remote',
            'track-after-undo',
            importedTrackId,
        ]);
        expect(requireProjectedTrackState().tracks[0]?.name).toBe('Remote rename');
        expect(
            requireProjectedTrackState()
                .tracks.at(-1)
                ?.clips.map((clip) => clip.id)
        ).toEqual([importedClipId]);
        expect(mocks.discardDecodedAudioFile).not.toHaveBeenCalled();
    });

    it('conflicts the whole import group when a peer renames only the imported track alternative', async () => {
        await expectPeerImportEditToConflict((track) => {
            track.alternatives[0]!.name = 'Peer alternative';
        });
    });

    it('conflicts the whole import group when a peer adds only another clip to the imported track', async () => {
        await expectPeerImportEditToConflict((track) => {
            track.clips.push(
                ClipDummy.create({
                    id: 'clip-peer-extra',
                    trackId: track.id,
                    name: 'Peer extra clip',
                    audioBufferId: 'buffer-peer',
                })
            );
        });
    });
});
