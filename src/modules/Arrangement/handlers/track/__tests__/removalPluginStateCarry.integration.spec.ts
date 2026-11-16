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
import { type AppAction } from '#/utils/handlerContract';

import { TrackDummy } from '../../../__tests__/TrackDummy';
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

// Restoring a track or device drives the live engine strip after commit, which jsdom's
// stubbed AudioContext cannot build. The subject is the plugin state project truth holds
// after each undo, so the engine seam is stubbed over the real barrel.
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    getAudioContext: vi.fn(() => ({ currentTime: 0, sampleRate: 48000 })),
    getAudioDevices: vi.fn(() => Promise.resolve([])),
    getTrackAnalyser: vi.fn(() => null),
    getMasterAnalyser: vi.fn(() => null),
    initializeTrackStripFromSnapshot: vi.fn(() => ({ acceptance: 'accepted', application: 'applied' })),
}));

// The live strip projection and device-chain delta build Web Audio nodes jsdom cannot;
// the subject is project truth.
vi.mock('../../../useCases/projectTrackToLiveStrip', () => ({
    projectTrackToLiveStrip: vi.fn(),
}));
vi.mock('../../../useCases/device/applyDeviceChainRuntimeDelta', () => ({
    applyDeviceChainRuntimeDelta: vi.fn(() => ({ acceptance: 'accepted', application: 'applied' })),
}));

const pluginHostMocks = vi.hoisted(() => ({
    activateExternalPlugin: vi.fn(),
    unloadPlugin: vi.fn(),
}));
vi.mock('#/modules/PluginHost/useCases', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    activateExternalPlugin: pluginHostMocks.activateExternalPlugin,
    unloadPlugin: pluginHostMocks.unloadPlugin,
}));

const presetDevice = {
    type: 'builtin-synth',
    name: 'Poly',
    parameterValues: {},
};
// The preset catalog is not the subject: the load only needs one preset its validation accepts.
vi.mock('../../../useCases/preset/findPresetById', () => ({
    findPresetById: (presetId: string) => {
        if (presetId !== 'preset-1') {
            return null;
        }
        return {
            id: 'preset-1',
            name: 'Poly',
            category: 'pad',
            description: '',
            trackKind: 'audio',
            devices: [presetDevice],
            tags: [],
            author: 'test',
            isFactory: true,
        };
    },
}));
vi.mock('../../../useCases/preset/matchesMaterializedPresetDevices', () => ({
    matchesMaterializedPresetDevices: () => true,
}));

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

const SNAPSHOT_CHUNK = 'c2F2ZWQ=';
const SAVED_CHUNK = 'ZWRpdGVk';

function hostedTrack(id = 'track-1') {
    return TrackDummy.create({
        id,
        name: 'Keys',
        kind: 'audio',
        devices: [
            {
                id: `${id}-plugin`,
                name: 'Reverb',
                type: 'external-plugin',
                bypassed: false,
                parameterValues: {},
                externalPluginId: 'plugin-abc',
                externalInstanceId: `${id}-instance`,
                externalStateChunk: SNAPSHOT_CHUNK,
            },
        ],
    });
}

function pluginDevice(trackId = 'track-1') {
    return trackStore.value?.tracks
        .find((track) => track.id === trackId)
        ?.devices.find((device) => device.externalPluginId);
}

/** The save path's write: a non-undoable capture of the restored plugin's live state. */
async function captureSavedPluginState(trackId = 'track-1'): Promise<void> {
    const device = pluginDevice(trackId)!;
    await executeAppAction(
        {
            type: 'setExternalPluginState',
            payload: {
                intent: 'capture',
                deviceId: device.id,
                stateChunk: SAVED_CHUNK,
                expectedInstanceId: device.externalInstanceId!,
                expectedStateChunk: device.externalStateChunk ?? null,
            },
        },
        { source: 'manual', skipMacroRecording: true }
    );
    expect(pluginDevice(trackId)?.externalStateChunk).toBe(SAVED_CHUNK);
}

function loadPresetAction(): AppAction {
    return {
        type: 'loadPreset',
        payload: {
            presetId: 'preset-1',
            trackId: 'track-1',
            expectedBefore: {
                id: 'track-1',
                kind: 'audio',
                devices: [
                    {
                        id: 'track-1-plugin',
                        type: 'external-plugin',
                        externalInstanceId: 'track-1-instance',
                        parameterIds: [],
                    },
                ],
            },
            expectedFrozen: false,
            devices: [{ id: 'preset-device-1', bypassed: false, ...presetDevice }],
        },
    };
}

const removalRoutes: ReadonlyArray<{ name: string; action: () => AppAction }> = [
    { name: 'removeTrack', action: () => ({ type: 'removeTrack', payload: { trackId: 'track-1' } }) },
    { name: 'removeAllTracks', action: () => ({ type: 'removeAllTracks' }) },
    { name: 'removeDevice', action: () => ({ type: 'removeDevice', payload: { deviceId: 'track-1-plugin' } }) },
    { name: 'loadPreset', action: loadPresetAction },
];

describe('removal undo after a redo carries the plugin state a save captured (issue #6841)', () => {
    beforeEach(() => {
        pluginHostMocks.activateExternalPlugin.mockReset();
        pluginHostMocks.unloadPlugin.mockReset();
        pluginHostMocks.activateExternalPlugin.mockReturnValue(Promise.resolve({ status: 'active' }));
        pluginHostMocks.unloadPlugin.mockResolvedValue(undefined);
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('removal plugin state carry integration');
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
        trackStore.set({ tracks: [hostedTrack()], selectedTrackId: 'track-1', ghostClips: [] });
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    for (const route of removalRoutes) {
        it(`${route.name}: remove, undo, save, redo, undo restores the saved chunk`, async () => {
            await executeAppAction(route.action(), { source: 'manual' });
            expect(pluginDevice()).toBeUndefined();

            await undo();
            expect(pluginDevice()?.externalStateChunk).toBe(SNAPSHOT_CHUNK);
            await captureSavedPluginState();

            await redo();
            expect(pluginDevice()).toBeUndefined();
            pluginHostMocks.activateExternalPlugin.mockClear();

            const second = await undo();

            expect(second).toEqual({ headConsumed: true });
            expect(pluginDevice()?.externalStateChunk).toBe(SAVED_CHUNK);
        });
    }

    it('removeTrack: a refused undo keeps the carried chunk for the retried undo', async () => {
        await executeAppAction({ type: 'removeTrack', payload: { trackId: 'track-1' } }, { source: 'manual' });
        await undo();
        await captureSavedPluginState();
        await redo();
        const removed = trackStore.value!;
        trackStore.set({
            ...removed,
            tracks: [...removed.tracks, TrackDummy.create({ id: 'track-1', name: 'Blocker', kind: 'audio' })],
        });

        const refused = await undo();
        expect(refused).toEqual({ headConsumed: false });
        expect(trackStore.value!.tracks.find((track) => track.id === 'track-1')!.name).toBe('Blocker');
        trackStore.set(removed);
        await undo();

        expect(pluginDevice()?.externalStateChunk).toBe(SAVED_CHUNK);
    });

    it('removeTrack: the first undo restores the snapshot chunk when no save intervened', async () => {
        await executeAppAction({ type: 'removeTrack', payload: { trackId: 'track-1' } }, { source: 'manual' });
        await undo();
        await redo();
        await undo();

        expect(pluginDevice()?.externalStateChunk).toBe(SNAPSHOT_CHUNK);
    });
});
