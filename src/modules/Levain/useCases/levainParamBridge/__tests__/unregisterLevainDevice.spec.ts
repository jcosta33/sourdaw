import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type DeviceWriteTargetResolution } from '#/modules/Arrangement/stores';

import { type MicPositionType } from '../../../models/LevainPatch';
import { levainStore } from '../../../stores/levainStore';
import { createLevainBridge, type LevainBridgeDeps } from '../helpers';
import { unregisterLevainDevice } from '../unregisterLevainDevice';

const bridge = {
    unregisterLevainDevice: vi.fn(),
};

vi.mock('../levainBridge', () => ({
    levainBridge: () => bridge,
}));

type PendingLoad = { port: MessagePort; instrumentId: string; signal: AbortSignal | undefined };

function makeDeps(loads: PendingLoad[]) {
    const autoLoadLevainSamples = vi.fn<LevainBridgeDeps['autoLoadLevainSamples']>(
        (_deviceId, port, instrumentId, signal) => {
            loads.push({ port, instrumentId, signal });
            // Never settles by itself: only an abort can end it.
            return new Promise<readonly (MicPositionType | null)[] | null>(() => {});
        }
    );
    return {
        getAllTracks: vi.fn(() => []),
        persistDeviceParam: vi.fn(),
        writeNativeBuiltinParameters: vi.fn(),
        sendNativeLiveMidiControl: vi.fn(() => Promise.resolve(true)),
        autoLoadLevainSamples,
        setLoadedMicPositions: vi.fn(),
        resolveEligibleDeviceWriteTarget: vi.fn((deviceId: string): DeviceWriteTargetResolution => ({
            status: 'eligible',
            trackId: 'track-1',
            deviceId,
        })),
    } satisfies LevainBridgeDeps;
}

function makeDevice() {
    return { setParam: vi.fn(), handleCc: vi.fn() };
}

describe('unregisterLevainDevice', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        levainStore.set({});
    });

    it('forwards the deviceId and its registered port to the bridge', () => {
        const port = {} as MessagePort;

        unregisterLevainDevice('dev-1', port);

        expect(bridge.unregisterLevainDevice).toHaveBeenCalledTimes(1);
        expect(bridge.unregisterLevainDevice).toHaveBeenCalledWith('dev-1', port);
    });

    it('ends the load in flight and refuses later loads once its own port unregisters', async () => {
        const loads: PendingLoad[] = [];
        const deps = makeDeps(loads);
        const levainBridge = createLevainBridge(deps);
        const port = {} as MessagePort;
        const registration = levainBridge.registerLevainDevice('d1', makeDevice(), port);
        expect(loads).toHaveLength(1);

        levainBridge.unregisterLevainDevice('d1', port);

        expect(loads[0]?.signal?.aborted).toBe(true);
        await expect(registration).resolves.toBe('cancelled');
        const later = levainBridge.loadSamplesForInstrument('d1', 'cello');
        expect(deps.autoLoadLevainSamples).toHaveBeenCalledOnce();
        await expect(later).resolves.toBe('failed');
        expect(levainStore.value).toEqual({});
    });

    it('leaves a newer registration under the same id intact when an older port unregisters', async () => {
        const loads: PendingLoad[] = [];
        const deps = makeDeps(loads);
        const levainBridge = createLevainBridge(deps);
        const olderPort = {} as MessagePort;
        const newerPort = {} as MessagePort;
        void levainBridge.registerLevainDevice('d1', makeDevice(), olderPort);
        const newerRegistration = levainBridge.registerLevainDevice('d1', makeDevice(), newerPort);
        const newerLoad = loads[1];
        expect(newerLoad?.port).toBe(newerPort);
        const newerEntry = levainStore.value?.d1;
        expect(newerEntry).toBeDefined();

        levainBridge.unregisterLevainDevice('d1', olderPort);

        expect(newerLoad?.signal?.aborted).toBe(false);
        expect(levainStore.value?.d1).toBe(newerEntry);
        void levainBridge.loadSamplesForInstrument('d1', 'cello');
        expect(loads.at(-1)?.port).toBe(newerPort);

        levainBridge.unregisterLevainDevice('d1', newerPort);

        await expect(newerRegistration).resolves.toBe('cancelled');
        expect(levainStore.value).toEqual({});
    });
});
