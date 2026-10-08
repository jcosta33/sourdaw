import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { trackStore } from '#/modules/Arrangement/stores';
import { createTrack, getArrangementHandlers, setArrangementEventBus } from '#/modules/Arrangement/useCases';
import { startInputMonitoring, stopInputMonitoring } from '#/modules/AudioEngine/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { clearUndoHistory, executeAppAction } from '#/modules/Command/useCases';

import { inputMonitoringSession } from '../inputMonitoringSession';

const engine = vi.hoisted(() => ({
    createMediaStreamSource: vi.fn(),
    ensureTrackStrip: vi.fn(),
    removeTrackStrip: vi.fn(),
}));

const getUserMedia = vi.fn<() => Promise<{ getTracks: () => Array<{ stop: () => void }> }>>();

vi.mock('../../createWebAudioEngine', () => ({
    audioEngine: {
        context: { createMediaStreamSource: engine.createMediaStreamSource },
        ensureTrackStrip: engine.ensureTrackStrip,
    },
}));
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    removeTrackStrip: engine.removeTrackStrip,
}));

function deferredGrant() {
    let grant: (stream: { getTracks: () => Array<{ stop: () => void }> }) => void = () => {
        throw new Error('Capture request was not started');
    };
    const request = new Promise<{ getTracks: () => Array<{ stop: () => void }> }>((resolve) => {
        grant = resolve;
    });
    return { request, grant };
}

describe('track deletion releases the input monitor at Command commit', () => {
    const originalMediaDevices = globalThis.navigator.mediaDevices;
    const source = { connect: vi.fn(), disconnect: vi.fn() };
    const inputTrack = { stop: vi.fn() };
    const stream = { getTracks: vi.fn(() => [inputTrack]) };
    const gains = new Map([
        ['a', { id: 'gain-a' }],
        ['b', { id: 'gain-b' }],
    ]);
    const commitRefusal = new Error('Refused track transaction');
    let doc: Record<string, unknown>;
    let refuseCommit: boolean;
    let docTrackIdsAtStop: string[];

    function docTrackIds(): string[] {
        const slot = doc.tracks;
        if (!slot || typeof slot !== 'object' || !('tracks' in slot) || !Array.isArray(slot.tracks)) {
            throw new Error('Expected committed tracks in the document');
        }
        return slot.tracks.map((track: { id: string }) => track.id);
    }

    function liveTrackIds(): string[] {
        return trackStore.value?.tracks.map((track) => track.id) ?? [];
    }

    function monitorOwners(): string[] {
        return [...inputMonitoringSession.trackKeys.keys()].sort();
    }

    beforeEach(() => {
        configureAutomergeStoragePort(null);
        stopInputMonitoring();
        vi.clearAllMocks();
        doc = {};
        refuseCommit = false;
        docTrackIdsAtStop = [];
        clearHandlerRegistry();
        const handlers = getArrangementHandlers();
        registerHandlerMap({ removeTrack: handlers.removeTrack, removeAllTracks: handlers.removeAllTracks });
        clearUndoHistory();
        setArrangementEventBus({ emit: async () => undefined });
        configureAutomergeStoragePort({
            getDoc: () => doc,
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            mutateDoc: ({ changeFn }) => {
                if (refuseCommit) {
                    throw commitRefusal;
                }
                changeFn(doc);
            },
        });
        trackStore.set({
            tracks: [
                createTrack({ id: 'a', name: 'Audio A', kind: 'audio', withoutDefaultDevice: true }),
                createTrack({ id: 'b', name: 'Audio B', kind: 'audio', withoutDefaultDevice: true }),
            ],
            selectedTrackId: null,
            ghostClips: [],
        });
        flushAutomergeStorageWrites();
        getUserMedia.mockResolvedValue(stream);
        engine.createMediaStreamSource.mockReturnValue(source);
        engine.ensureTrackStrip.mockImplementation((trackId: string) => ({ gainNode: gains.get(trackId) }));
        inputTrack.stop.mockImplementation(() => {
            docTrackIdsAtStop = docTrackIds();
        });
        Object.defineProperty(globalThis.navigator, 'mediaDevices', {
            value: { getUserMedia },
            configurable: true,
        });
    });

    afterEach(() => {
        refuseCommit = false;
        stopInputMonitoring();
        clearUndoHistory();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        Object.defineProperty(globalThis.navigator, 'mediaDevices', {
            value: originalMediaDevices,
            configurable: true,
        });
    });

    it('retains both owners after a refused single delete, then releases only committed owners', async () => {
        await startInputMonitoring('a', null);
        await startInputMonitoring('b', null);
        source.disconnect.mockClear();

        refuseCommit = true;
        await expect(executeAppAction({ type: 'removeTrack', payload: { trackId: 'a' } })).rejects.toBe(commitRefusal);
        refuseCommit = false;
        expect(docTrackIds()).toEqual(['a', 'b']);
        expect(liveTrackIds()).toEqual(['a', 'b']);
        expect(monitorOwners()).toEqual(['a', 'b']);
        expect(source.disconnect).not.toHaveBeenCalled();
        expect(inputTrack.stop).not.toHaveBeenCalled();

        await executeAppAction({ type: 'removeTrack', payload: { trackId: 'a' } });
        expect(docTrackIds()).toEqual(['b']);
        expect(liveTrackIds()).toEqual(['b']);
        expect(monitorOwners()).toEqual(['b']);
        expect(source.disconnect).toHaveBeenCalledWith(gains.get('a'));
        expect(source.disconnect).not.toHaveBeenCalledWith(gains.get('b'));
        expect(inputTrack.stop).not.toHaveBeenCalled();

        await executeAppAction({ type: 'removeTrack', payload: { trackId: 'b' } });
        expect(docTrackIds()).toEqual([]);
        expect(liveTrackIds()).toEqual([]);
        expect(source.disconnect).toHaveBeenCalledWith(gains.get('b'));
        expect(inputTrack.stop).toHaveBeenCalledOnce();
        expect(docTrackIdsAtStop).toEqual([]);
    });

    it('retains both owners after a refused bulk delete and releases both after commit', async () => {
        await startInputMonitoring('a', null);
        await startInputMonitoring('b', null);
        source.disconnect.mockClear();

        refuseCommit = true;
        await expect(executeAppAction({ type: 'removeAllTracks', payload: undefined })).rejects.toBe(commitRefusal);
        refuseCommit = false;
        expect(docTrackIds()).toEqual(['a', 'b']);
        expect(liveTrackIds()).toEqual(['a', 'b']);
        expect(monitorOwners()).toEqual(['a', 'b']);
        expect(source.disconnect).not.toHaveBeenCalled();
        expect(inputTrack.stop).not.toHaveBeenCalled();

        await executeAppAction({ type: 'removeAllTracks', payload: undefined });
        expect(docTrackIds()).toEqual([]);
        expect(liveTrackIds()).toEqual([]);
        expect(monitorOwners()).toEqual([]);
        expect(source.disconnect).toHaveBeenCalledWith(gains.get('a'));
        expect(source.disconnect).toHaveBeenCalledWith(gains.get('b'));
        expect(inputTrack.stop).toHaveBeenCalledOnce();
        expect(docTrackIdsAtStop).toEqual([]);
    });

    it('does not reconnect or recreate a deleted strip when permission arrives after commit', async () => {
        const pending = deferredGrant();
        getUserMedia.mockReturnValue(pending.request);
        const starting = startInputMonitoring('a', null);

        await executeAppAction({ type: 'removeTrack', payload: { trackId: 'a' } });
        expect(docTrackIds()).toEqual(['b']);
        expect(monitorOwners()).toEqual([]);
        pending.grant(stream);

        expect(await starting).toBe(false);
        expect(engine.ensureTrackStrip).not.toHaveBeenCalled();
        expect(engine.createMediaStreamSource).not.toHaveBeenCalled();
        expect(inputTrack.stop).toHaveBeenCalledOnce();
    });
});
