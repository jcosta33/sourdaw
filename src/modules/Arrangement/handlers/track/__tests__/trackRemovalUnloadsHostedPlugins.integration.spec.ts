import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, macroStore, registerHandlerMap } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
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
import { type Track, trackStore } from '../../../stores/trackStore';
import { ArrangementEventBus, setArrangementEventBus } from '../../../useCases/arrangementEventBus';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

class NoopArrangementEventBus extends ArrangementEventBus {
    async emit(): Promise<void> {}
}

// Restoring a track drives the live engine strip, which jsdom's stubbed AudioContext cannot
// build. The subject is which instance ids the removal and its undo ask the plugin host for,
// so the engine seam is stubbed over the real barrel and the strip projection stays real.
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    getAudioContext: vi.fn(() => ({ currentTime: 0, sampleRate: 48000 })),
    getAudioDevices: vi.fn(() => Promise.resolve([])),
    getTrackAnalyser: vi.fn(() => null),
    getMasterAnalyser: vi.fn(() => null),
    createTrackStrip: vi.fn(),
    initializeTrackStripFromSnapshot: vi.fn(() => ({ acceptance: 'accepted', application: 'applied' })),
    removeTrackStrip: vi.fn(),
    updateDeviceParam: vi.fn(),
    setTrackGain: vi.fn(),
    setTrackPan: vi.fn(),
    setTrackMute: vi.fn(),
    setTrackSolo: vi.fn(),
    setTrackSoloGate: vi.fn(),
}));

const pluginHostMocks = vi.hoisted(() => ({
    activateExternalPlugin: vi.fn(),
    unloadPluginCarryingLiveState: vi.fn(),
}));
vi.mock('#/modules/PluginHost/useCases', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    activateExternalPlugin: pluginHostMocks.activateExternalPlugin,
    unloadPluginCarryingLiveState: pluginHostMocks.unloadPluginCarryingLiveState,
}));

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

function hostedDevice(trackId: string, slot: number): Track['devices'][number] {
    return {
        id: `${trackId}-plugin-${slot}`,
        name: `Plugin ${slot}`,
        type: 'external-plugin',
        bypassed: false,
        parameterValues: {},
        externalPluginId: `plugin-${slot}`,
        externalInstanceId: `${trackId}-instance-${slot}`,
        externalStateChunk: 'c2F2ZWQ=',
    };
}

function hostedTrack(id: string): Track {
    return TrackDummy.create({ id, name: id, kind: 'audio', devices: [hostedDevice(id, 1), hostedDevice(id, 2)] });
}

function trackIds(): string[] {
    return trackStore.value?.tracks.map((track) => track.id) ?? [];
}

function activatedInstanceIds(): string[] {
    return pluginHostMocks.activateExternalPlugin.mock.calls.map(
        ([request]) => (request as { instanceId: string }).instanceId
    );
}

const routes: ReadonlyArray<{ name: string; action: AppAction; removedTrackIds: readonly string[] }> = [
    {
        name: 'removeTrack',
        action: { type: 'removeTrack', payload: { trackId: 'track-1' } },
        removedTrackIds: ['track-1'],
    },
    { name: 'removeAllTracks', action: { type: 'removeAllTracks' }, removedTrackIds: ['track-1', 'track-2'] },
];

// Issue #6557: a removed track's hosted instances stayed loaded, with their editors open,
// until the project was replaced.
describe('track removal releases its hosted plugin instances', () => {
    beforeEach(() => {
        pluginHostMocks.activateExternalPlugin.mockReset();
        pluginHostMocks.unloadPluginCarryingLiveState.mockReset();
        pluginHostMocks.activateExternalPlugin.mockReturnValue(Promise.resolve({ status: 'active' }));
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('track removal unload integration');
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
        trackStore.set({
            tracks: [hostedTrack('track-1'), hostedTrack('track-2')],
            selectedTrackId: 'track-1',
            ghostClips: [],
        });
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    for (const route of routes) {
        const expectedInstanceIds = route.removedTrackIds.flatMap((trackId) => [
            `${trackId}-instance-1`,
            `${trackId}-instance-2`,
        ]);

        it(`${route.name}: unloads every hosted instance once its track has left the project`, async () => {
            const tracksPresentAtUnload: string[][] = [];
            pluginHostMocks.unloadPluginCarryingLiveState.mockImplementation(async () => {
                tracksPresentAtUnload.push(trackIds());
            });

            await executeAppAction(route.action, { source: 'manual' });

            expect(pluginHostMocks.unloadPluginCarryingLiveState.mock.calls.map(([id]) => id)).toEqual(
                expectedInstanceIds
            );
            for (const present of tracksPresentAtUnload) {
                expect(present).not.toEqual(expect.arrayContaining([...route.removedTrackIds]));
            }
        });

        it(`${route.name}: undo reactivates every unloaded instance under its own id`, async () => {
            pluginHostMocks.unloadPluginCarryingLiveState.mockResolvedValue(undefined);
            await executeAppAction(route.action, { source: 'manual' });
            pluginHostMocks.activateExternalPlugin.mockClear();

            await undo();

            expect(trackIds()).toEqual(['track-1', 'track-2']);
            expect([...activatedInstanceIds()].sort()).toEqual([...expectedInstanceIds].sort());
        });
    }
});
