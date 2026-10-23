import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    clearRuntimeCachedAudioBuffers: vi.fn(),
    getAudioContext: vi.fn(() => ({})),
    importCachedAudioBuffers: vi.fn(() => Promise.resolve({ persist: () => Promise.resolve(true), publish: () => 0 })),
    prepareCachedAudioBuffersFromIdb: vi.fn(() => Promise.resolve({ cancel: () => undefined, publish: () => 0 })),
    applyRuntimeGraphDelta: vi.fn(() => ({ acceptance: 'accepted', application: 'applied' })),
    mirrorDeviceChainDelta: vi.fn(() => Promise.resolve()),
    resetAudioGraph: vi.fn(),
    setMasterGainValue: vi.fn(),
}));
vi.mock('#/modules/PluginHost/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/PluginHost/useCases')>()),
    unloadPlugin: vi.fn(() => Promise.resolve()),
}));
vi.mock('#/modules/Transport/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Transport/useCases')>()),
    ensureTrackStrips: vi.fn(() => ({ status: 'ready', externalPluginActivations: [] })),
    stopPlayback: vi.fn(() => Promise.resolve()),
}));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { createControlledLockManager } from '#/infra/testing/createControlledLockManager';
import { installTransactionalIndexedDb } from '#/infra/testing/installTransactionalIndexedDb';
import { persistDeviceParam, resolveEligibleDeviceWriteTarget, trackStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers, setArrangementEventBus } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { clearUndoHistory, executeAppAction, resetActionReplayAuthority } from '#/modules/Command/useCases';
import { registerCrdtStorageRuntime, removeCrdtDoc, resetCrdtProjectAuthority } from '#/modules/CrdtDocument/useCases';
import {
    applyImportedProjectData,
    buildProjectData,
    newProject,
    setProjectIdentityTransitionDependencies,
} from '#/modules/Project/useCases';

import { defaultLevainState, levainStore, setLoadedMicPositions, updateMicPosition } from '../../stores/levainStore';
import { hydrateLevainStateFromProject } from '../hydrateLevainStateFromProject';
import { initLevainDeviceStatePersistence } from '../initLevainDeviceStatePersistence';
import { levainBridge } from '../levainParamBridge/levainBridge';
import { registerLevainDevice } from '../levainParamBridge/registerLevainDevice';
import { sendMicParamToEngine } from '../levainParamBridge/sendMicParamToEngine';
import { setLevainParamWithAudio } from '../levainParamBridge/setLevainParamWithAudio';
import { unregisterLevainDevice } from '../levainParamBridge/unregisterLevainDevice';
import { loadInstrument } from '../loadPreset';

const devices = [
    { trackId: 'track-cello', deviceId: 'levain-cello', instrumentId: 'cello', gain: 0.43, mic: 0.31 },
    { trackId: 'track-horn', deviceId: 'levain-horn', instrumentId: 'horn', gain: 0.78, mic: 0.64 },
] as const;

function savedDevice(deviceId: string) {
    return trackStore.value?.tracks.flatMap((track) => track.devices).find((device) => device.id === deviceId);
}

describe('two Levain patches across a named-project reopen', () => {
    let indexedDb: ReturnType<typeof installTransactionalIndexedDb>;
    let stopPersistence: () => void;
    let frameCallbacks: FrameRequestCallback[];

    beforeEach(async () => {
        vi.stubGlobal('navigator', { ...navigator, locks: createControlledLockManager().locks });
        frameCallbacks = [];
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
            frameCallbacks.push(callback);
            return frameCallbacks.length;
        });
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
        Container.clear();
        localStorage.clear();
        indexedDb = installTransactionalIndexedDb();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('Levain round-trip bootstrap');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: () => Promise.resolve() });
        injectDependencies(levainBridge, {
            persistDeviceParam,
            resolveEligibleDeviceWriteTarget,
            autoLoadLevainSamples: vi.fn(() => Promise.resolve(['close', 'room'] as const)),
            setLoadedMicPositions,
            writeNativeBuiltinParameters: vi.fn(),
            sendNativeLiveMidiControl: vi.fn(() => Promise.resolve(true)),
        });
        setArrangementEventBus({ emit: () => Promise.resolve() });
        expect(await newProject('Two Levain instruments')).toBe(true);
        stopPersistence = initLevainDeviceStatePersistence();
    });

    afterEach(async () => {
        stopPersistence?.();
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        Container.clear();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        await indexedDb?.dispose();
        vi.unstubAllGlobals();
    });

    it('saves and restores distinct identities, articulations, gains and mic mixes through ProjectData JSON', async () => {
        const ports = new Map<string, MessagePort>();
        for (const { trackId, deviceId } of devices) {
            await executeAppAction({
                type: 'addTrack',
                payload: { id: trackId, name: trackId, kind: 'midi', select: false },
            });
            await executeAppAction({
                type: 'addDevice',
                payload: { trackId, deviceId, deviceType: 'levain' },
            });
            const port = { postMessage: vi.fn() } as unknown as MessagePort;
            ports.set(deviceId, port);
            await expect(registerLevainDevice(deviceId, { setParam: vi.fn(), handleCc: vi.fn() }, port)).resolves.toBe(
                'ready'
            );
        }

        for (const { deviceId, instrumentId, gain, mic } of devices) {
            loadInstrument(deviceId, instrumentId);
            setLevainParamWithAudio(
                deviceId,
                'currentArticulation',
                deviceId === 'levain-cello' ? 'tremolo' : 'staccato'
            );
            setLevainParamWithAudio(deviceId, 'masterGain', gain);
            updateMicPosition(deviceId, 0, { volume: mic });
            sendMicParamToEngine(deviceId, 0, 'volume', mic);
        }
        for (const callback of frameCallbacks.splice(0)) {
            callback(0);
        }
        await vi.waitFor(() => {
            for (const { deviceId, instrumentId, gain, mic } of devices) {
                expect(savedDevice(deviceId)?.deviceState?.data).toMatchObject({ instrumentId });
                expect(savedDevice(deviceId)?.parameterValues).toMatchObject({ masterGain: gain, mic0Volume: mic });
            }
        });

        const built = await buildProjectData();
        expect(built).not.toBeNull();
        const savedJson = JSON.stringify(built?.data);
        const onDisk: unknown = JSON.parse(savedJson);
        for (const { deviceId } of devices) {
            unregisterLevainDevice(deviceId, ports.get(deviceId)!);
        }
        expect(await applyImportedProjectData({ data: onDisk })).toBe(true);
        expect(levainStore.value).toEqual({});

        for (const { deviceId, instrumentId, gain, mic } of devices) {
            const port = { postMessage: vi.fn() } as unknown as MessagePort;
            await expect(registerLevainDevice(deviceId, { setParam: vi.fn(), handleCc: vi.fn() }, port)).resolves.toBe(
                'ready'
            );
            expect(savedDevice(deviceId)?.deviceState?.data).toMatchObject({ instrumentId });
            expect(savedDevice(deviceId)?.parameterValues).toMatchObject({ masterGain: gain, mic0Volume: mic });
            expect(hydrateLevainStateFromProject(deviceId)?.patch).toMatchObject({ instrumentId, masterGain: gain });
            expect(levainStore.value?.[deviceId]?.patch).toMatchObject({ instrumentId, masterGain: gain });
            expect(levainStore.value?.[deviceId]?.patch.micPositions[0]?.volume).toBe(mic);
            expect(levainStore.value?.[deviceId]?.patch.currentArticulation).toBe(
                deviceId === 'levain-cello' ? 'tremolo' : 'staccato'
            );
            unregisterLevainDevice(deviceId, port);
        }
        expect(levainStore.value).toEqual({});
        expect(defaultLevainState.patch.instrumentId).toBe('violin-1');
    });
});
