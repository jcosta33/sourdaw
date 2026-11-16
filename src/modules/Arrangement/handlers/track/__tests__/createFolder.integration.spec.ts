import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, macroStore, registerHandlerMap } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
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

import { trackStore } from '../../../stores/trackStore';
import { ArrangementEventBus, setArrangementEventBus } from '../../../useCases/arrangementEventBus';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';

const notifyUserMock = vi.hoisted(() => vi.fn());
// A refused undo reports through the notification seam, which needs the UI event bus.
vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: notifyUserMock,
}));

class NoopArrangementEventBus extends ArrangementEventBus {
    async emit(): Promise<void> {}
}

// Restoring a track drives the live engine strip after commit, which jsdom's stubbed
// AudioContext cannot build. The subject is which tracks project truth holds after each
// undo and redo, so the engine seam is stubbed over the real barrel.
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    getAudioContext: vi.fn(() => ({ currentTime: 0, sampleRate: 48000 })),
    getAudioDevices: vi.fn(() => Promise.resolve([])),
    getTrackAnalyser: vi.fn(() => null),
    getMasterAnalyser: vi.fn(() => null),
    initializeTrackStripFromSnapshot: vi.fn(() => ({ acceptance: 'accepted', application: 'applied' })),
}));

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

function renameFolder(name: string): void {
    const state = trackStore.value!;
    trackStore.set({
        ...state,
        tracks: state.tracks.map((track) => (track.kind === 'folder' ? { ...track, name } : track)),
    });
}

async function createFolder(): Promise<string> {
    await executeAppAction({ type: 'createFolder', payload: { name: 'Drums' } }, { source: 'manual' });
    const folder = trackStore.value!.tracks.find((track) => track.kind === 'folder');
    expect(folder).toBeDefined();
    return folder!.id;
}

describe('createFolder undo/redo integration (issue #6817)', () => {
    beforeEach(() => {
        notifyUserMock.mockClear();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('create folder integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        setArrangementEventBus(new NoopArrangementEventBus());
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('removes the folder on undo', async () => {
        await createFolder();

        const result = await undo();

        expect(result).toEqual({ headConsumed: true });
        expect(trackStore.value?.tracks).toEqual([]);
    });

    it('refuses the undo and keeps the folder once a collaborator renamed it', async () => {
        const folderId = await createFolder();
        renameFolder('Percussion');

        const result = await undo();

        expect(result).toEqual({ headConsumed: false });
        expect(notifyUserMock).toHaveBeenCalledWith(
            'Cannot undo "Create folder "Drums"": project state has changed',
            'warning'
        );
        expect(trackStore.value!.tracks.map((track) => [track.id, track.name])).toEqual([[folderId, 'Percussion']]);
    });

    it('redoes the exact folder it undid, so a second undo removes it again', async () => {
        const folderId = await createFolder();
        const committed = structuredClone(trackStore.value!.tracks[0]);
        await undo();

        await redo();

        expect(trackStore.value!.tracks.map((track) => track.id)).toEqual([folderId]);
        expect(trackStore.value!.tracks[0]).toEqual(committed);
        const second = await undo();
        expect(second).toEqual({ headConsumed: true });
        expect(trackStore.value?.tracks).toEqual([]);
    });

    it('refuses the undo after a redo once a collaborator renamed the folder', async () => {
        await createFolder();
        await undo();
        await redo();
        renameFolder('Percussion');

        const result = await undo();

        expect(result).toEqual({ headConsumed: false });
        expect(notifyUserMock).toHaveBeenCalledWith(
            'Cannot undo "Create folder "Drums"": project state has changed',
            'warning'
        );
        expect(trackStore.value!.tracks.map((track) => track.name)).toEqual(['Percussion']);
    });
});
