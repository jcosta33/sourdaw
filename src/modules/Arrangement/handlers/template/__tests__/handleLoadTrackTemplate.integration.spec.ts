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
import { trackTemplateCache } from '../../../useCases/trackTemplate';
import { handleLoadTrackTemplate } from '../handleLoadTrackTemplate';

const notifyUserMock = vi.hoisted(() => vi.fn());
// A refused undo reports through the notification seam, which needs the UI event bus.
vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: notifyUserMock,
}));

class NoopArrangementEventBus extends ArrangementEventBus {
    async emit(): Promise<void> {}
}

// Restoring a track drives the live engine strip on `afterCommit`, which jsdom's
// stubbed AudioContext cannot build. The subject here is which tracks project truth
// holds after undo and redo, so the engine seam is stubbed rather than exercised.
// Partial, over the real barrel: the restore path reaches further into the engine
// than a hand-listed mock can anticipate, and a missing export fails as an
// unrelated post-commit error rather than as the assertion under test.
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
    unloadPlugin: vi.fn(),
}));
// Only the two lifecycle calls are stubbed: the subject is which instance ids the
// template load requests from the plugin host, not the native host itself.
vi.mock('#/modules/PluginHost/useCases', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    activateExternalPlugin: pluginHostMocks.activateExternalPlugin,
    unloadPlugin: pluginHostMocks.unloadPlugin,
    // The discard unload carries live state; its instance ids are this spec's subject.
    unloadPluginCarryingLiveState: pluginHostMocks.unloadPlugin,
}));

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

describe('loadTrackTemplate undo/redo integration', () => {
    beforeEach(() => {
        notifyUserMock.mockClear();
        pluginHostMocks.activateExternalPlugin.mockClear();
        pluginHostMocks.unloadPlugin.mockClear();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('load track template integration');
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
        trackTemplateCache.templates = [
            {
                id: 'tmpl-lead',
                name: 'Lead',
                category: 'user',
                trackKind: 'audio',
                devices: [],
                sends: [],
                gain: 0.8,
                pan: 0,
                color: '#123456',
                createdAt: 0,
            },
        ];
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        trackTemplateCache.templates = null;
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('redoes the template load by restoring the tracks it created, so the next undo can still remove them', async () => {
        await executeAppAction(
            { type: 'loadTrackTemplate', payload: { templateId: 'tmpl-lead' } },
            {
                source: 'manual',
            }
        );

        expect(trackStore.value?.tracks).toHaveLength(1);
        const createdId = trackStore.value!.tracks[0]!.id;

        await undo();
        expect(trackStore.value?.tracks).toEqual([]);

        await redo();
        // `loadTrackTemplate` mints `track-${crypto.randomUUID()}` on every run, so a
        // redo that replayed the forward action would leave a track the undo entry's
        // `discardCreatedTracks` inverse does not name.
        expect(trackStore.value?.tracks.map((track) => track.id)).toEqual([createdId]);

        await undo();
        // The decisive assertion: undo after redo actually removes the template's
        // tracks. Against a redo that re-ran the template, `discardCreatedTracks`
        // conflicts on an id nothing holds, so this leaves the track in the project —
        // and, because a conflicted undo does not pop its entry, every later undo
        // press retries it and no older entry is ever reachable again.
        expect(trackStore.value?.tracks).toEqual([]);
    });

    it('keeps unwinding past the template entry after a redo', async () => {
        await executeAppAction({ type: 'addTrack', payload: { name: 'Drums', kind: 'audio' } }, { source: 'manual' });
        const firstTrackId = trackStore.value!.tracks[0]!.id;

        await executeAppAction(
            { type: 'loadTrackTemplate', payload: { templateId: 'tmpl-lead' } },
            {
                source: 'manual',
            }
        );
        expect(trackStore.value?.tracks).toHaveLength(2);

        await undo();
        await redo();
        await undo();
        expect(trackStore.value?.tracks.map((track) => track.id)).toEqual([firstTrackId]);

        // The entry beneath the template load is only reachable when the template
        // entry itself popped.
        await undo();
        expect(trackStore.value?.tracks).toEqual([]);
    });

    function installHostedTemplate(): void {
        trackTemplateCache.templates = [
            {
                id: 'tmpl-hosted',
                name: 'Hosted',
                category: 'user',
                trackKind: 'audio',
                devices: [
                    {
                        id: 'tmpl-device',
                        name: 'Reverb',
                        type: 'external-plugin',
                        bypassed: false,
                        parameterValues: {},
                        externalPluginId: 'plugin-abc',
                        // A legacy template saved with a stale id must never reuse it.
                        externalInstanceId: 'plugin-abc-live',
                        externalStateChunk: 'c2F2ZWQ=',
                    },
                ],
                sends: [],
                gain: 1,
                pan: 0,
                color: '#123456',
                createdAt: 0,
            },
        ];
    }

    it('activates a template-loaded hosted plugin under a fresh instance and unloads it on undo', async () => {
        installHostedTemplate();
        pluginHostMocks.activateExternalPlugin.mockReturnValue(Promise.resolve({ status: 'active' }));
        pluginHostMocks.unloadPlugin.mockResolvedValue(undefined);

        await executeAppAction(
            { type: 'loadTrackTemplate', payload: { templateId: 'tmpl-hosted' } },
            { source: 'manual' }
        );

        const instanceId = trackStore.value!.tracks[0]!.devices[0]!.externalInstanceId;
        expect(instanceId).toMatch(/^plugin-abc-.+/);
        expect(instanceId).not.toBe('plugin-abc-live');
        expect(pluginHostMocks.activateExternalPlugin).toHaveBeenCalledWith(
            expect.objectContaining({ pluginId: 'plugin-abc', instanceId, stateChunk: 'c2F2ZWQ=' })
        );
        expect(pluginHostMocks.unloadPlugin).not.toHaveBeenCalled();

        await undo();

        expect(trackStore.value?.tracks).toEqual([]);
        expect(pluginHostMocks.unloadPlugin).toHaveBeenCalledTimes(1);
        expect(pluginHostMocks.unloadPlugin).toHaveBeenCalledWith(instanceId);
    });

    async function captureLoadedPluginState(stateChunk: string): Promise<void> {
        const device = trackStore.value!.tracks[0]!.devices[0]!;
        await executeAppAction(
            {
                type: 'setExternalPluginState',
                payload: {
                    intent: 'capture',
                    deviceId: device.id,
                    stateChunk,
                    expectedInstanceId: device.externalInstanceId!,
                    expectedStateChunk: device.externalStateChunk ?? null,
                },
            },
            { source: 'manual', skipMacroRecording: true }
        );
        expect(trackStore.value!.tracks[0]!.devices[0]!.externalStateChunk).toBe(stateChunk);
    }

    it('redoes a template load with the plugin state a save captured, not the template chunk (issue #6597)', async () => {
        installHostedTemplate();
        pluginHostMocks.activateExternalPlugin.mockReturnValue(Promise.resolve({ status: 'active' }));
        pluginHostMocks.unloadPlugin.mockResolvedValue(undefined);
        await executeAppAction(
            { type: 'loadTrackTemplate', payload: { templateId: 'tmpl-hosted' } },
            { source: 'manual' }
        );
        const createdId = trackStore.value!.tracks[0]!.id;
        const instanceId = trackStore.value!.tracks[0]!.devices[0]!.externalInstanceId;
        await captureLoadedPluginState('ZWRpdGVk');

        await undo();
        expect(trackStore.value?.tracks).toEqual([]);
        expect(pluginHostMocks.unloadPlugin).toHaveBeenCalledWith(instanceId);
        pluginHostMocks.activateExternalPlugin.mockClear();

        await redo();
        expect(trackStore.value!.tracks.map((track) => track.id)).toEqual([createdId]);
        expect(trackStore.value!.tracks[0]!.devices[0]!.externalStateChunk).toBe('ZWRpdGVk');
        expect(pluginHostMocks.activateExternalPlugin).toHaveBeenCalledWith(
            expect.objectContaining({ stateChunk: 'ZWRpdGVk' })
        );

        await undo();
        expect(trackStore.value?.tracks).toEqual([]);
    });

    it('gives every load of the same template a distinct instance id', async () => {
        installHostedTemplate();
        pluginHostMocks.activateExternalPlugin.mockReturnValue(Promise.resolve({ status: 'active' }));

        await executeAppAction(
            { type: 'loadTrackTemplate', payload: { templateId: 'tmpl-hosted' } },
            { source: 'manual' }
        );
        await executeAppAction(
            { type: 'loadTrackTemplate', payload: { templateId: 'tmpl-hosted' } },
            { source: 'manual' }
        );

        const instanceIds = trackStore.value!.tracks.map((track) => track.devices[0]!.externalInstanceId);
        expect(instanceIds).toHaveLength(2);
        expect(new Set([...instanceIds, 'plugin-abc-live']).size).toBe(3);
    });

    it('activates the loaded plugin with its committed id and chunk when commit status is ambiguous', async () => {
        installHostedTemplate();
        pluginHostMocks.activateExternalPlugin.mockReturnValue(Promise.resolve({ status: 'active' }));

        const result = await handleLoadTrackTemplate.execute({
            type: 'loadTrackTemplate',
            payload: { templateId: 'tmpl-hosted' },
        });
        if (!result?.afterAmbiguousCommit) {
            throw new Error('Expected an afterAmbiguousCommit effect for a template holding a hosted plugin');
        }
        const instanceId = trackStore.value!.tracks[0]!.devices[0]!.externalInstanceId;
        expect(pluginHostMocks.activateExternalPlugin).not.toHaveBeenCalled();

        await result.afterAmbiguousCommit();

        expect(pluginHostMocks.activateExternalPlugin).toHaveBeenCalledWith(
            expect.objectContaining({ pluginId: 'plugin-abc', instanceId, stateChunk: 'c2F2ZWQ=' })
        );
    });
    function renameCreatedTrack(name: string): void {
        const state = trackStore.value!;
        trackStore.set({
            ...state,
            tracks: state.tracks.map((track, index) => (index === 0 ? { ...track, name } : track)),
        });
    }

    it('refuses the undo and keeps the track once a collaborator edited what the template created (issue #6817)', async () => {
        await executeAppAction(
            { type: 'loadTrackTemplate', payload: { templateId: 'tmpl-lead' } },
            { source: 'manual' }
        );
        const createdId = trackStore.value!.tracks[0]!.id;
        renameCreatedTrack('Collaborator lead');

        const result = await undo();

        expect(result).toEqual({ headConsumed: false });
        expect(notifyUserMock).toHaveBeenCalledWith(
            'Cannot undo "Load Track Template": project state has changed',
            'warning'
        );
        expect(trackStore.value!.tracks.map((track) => [track.id, track.name])).toEqual([
            [createdId, 'Collaborator lead'],
        ]);
    });

    it('undoes a template load whose only change since is a plugin state capture (issue #6817)', async () => {
        installHostedTemplate();
        pluginHostMocks.activateExternalPlugin.mockReturnValue(Promise.resolve({ status: 'active' }));
        pluginHostMocks.unloadPlugin.mockResolvedValue(undefined);
        await executeAppAction(
            { type: 'loadTrackTemplate', payload: { templateId: 'tmpl-hosted' } },
            { source: 'manual' }
        );
        await captureLoadedPluginState('ZWRpdGVk');

        const result = await undo();

        expect(result).toEqual({ headConsumed: true });
        expect(trackStore.value?.tracks).toEqual([]);
    });

    it('refuses the undo after a redo once a collaborator edited the restored track (issue #6817)', async () => {
        await executeAppAction(
            { type: 'loadTrackTemplate', payload: { templateId: 'tmpl-lead' } },
            { source: 'manual' }
        );
        await undo();
        await redo();
        renameCreatedTrack('Collaborator lead');

        const result = await undo();

        expect(result).toEqual({ headConsumed: false });
        expect(notifyUserMock).toHaveBeenCalledWith(
            'Cannot undo "Load Track Template": project state has changed',
            'warning'
        );
        expect(trackStore.value!.tracks.map((track) => track.name)).toEqual(['Collaborator lead']);
    });
});
