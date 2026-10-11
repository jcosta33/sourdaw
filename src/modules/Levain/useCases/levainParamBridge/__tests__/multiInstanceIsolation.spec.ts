import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setCurrentArticulation, updateMicPosition, levainStore } from '../../../stores/levainStore';
import { createLevainBridge, type LevainBridgeDeps } from '../helpers';

type Load = {
    deviceId: string;
    port: MessagePort;
    settle: PromiseWithResolvers<readonly ('close' | 'room')[] | null>;
};

describe('Levain bridge instance isolation', () => {
    const channels: MessageChannel[] = [];
    let frames: FrameRequestCallback[];

    beforeEach(() => {
        levainStore.set({});
        frames = [];
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
            frames.push(callback);
            return frames.length;
        });
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
    });

    afterEach(() => {
        for (const channel of channels.splice(0)) {
            channel.port1.close();
            channel.port2.close();
        }
        vi.unstubAllGlobals();
    });

    function channel(): MessageChannel {
        const result = new MessageChannel();
        channels.push(result);
        return result;
    }

    it('keeps both ports, state, engine writes and pending work addressed through teardown', async () => {
        const loads: Load[] = [];
        const nativeWrite = vi.fn();
        const persist = vi.fn();
        const deps = {
            persistDeviceParam: persist,
            writeNativeBuiltinParameters: nativeWrite,
            sendNativeLiveMidiControl: vi.fn(() => Promise.resolve(true)),
            setLoadedMicPositions: vi.fn(),
            resolveEligibleDeviceWriteTarget: vi.fn((deviceId: string) => ({
                status: 'eligible' as const,
                trackId: `track-${deviceId}`,
                deviceId,
            })),
            autoLoadLevainSamples: vi.fn((deviceId: string, port: MessagePort) => {
                const settle = Promise.withResolvers<readonly ('close' | 'room')[] | null>();
                loads.push({ deviceId, port, settle });
                port.postMessage({ loadedFor: deviceId });
                return settle.promise;
            }),
        } satisfies LevainBridgeDeps;
        const bridge = createLevainBridge(deps);
        const a = channel();
        const b = channel();
        const receivedA: unknown[] = [];
        const receivedB: unknown[] = [];
        a.port2.onmessage = (event) => receivedA.push(event.data);
        b.port2.onmessage = (event) => receivedB.push(event.data);
        const deviceA = { setParam: vi.fn(), handleCc: vi.fn() };
        const deviceB = { setParam: vi.fn(), handleCc: vi.fn() };

        const registeredA = bridge.registerLevainDevice('a', deviceA, a.port1, vi.fn());
        const registeredB = bridge.registerLevainDevice('b', deviceB, b.port1, vi.fn());
        expect(loads.map(({ deviceId, port }) => [deviceId, port])).toEqual([
            ['a', a.port1],
            ['b', b.port1],
        ]);
        await vi.waitFor(() => {
            expect(receivedA).toEqual([{ loadedFor: 'a' }]);
            expect(receivedB).toEqual([{ loadedFor: 'b' }]);
        });
        loads[0]!.settle.resolve(['close']);
        loads[1]!.settle.resolve(['room']);
        await expect(registeredA).resolves.toBe('ready');
        await expect(registeredB).resolves.toBe('ready');
        expect(bridge.readRegistrySizes().committedBanks).toBe(2);

        const beforeB = JSON.stringify(levainStore.value?.b);
        deviceA.setParam.mockClear();
        deviceB.setParam.mockClear();
        nativeWrite.mockClear();
        bridge.setLevainParamWithAudio('a', 'masterGain', 0.41);
        bridge.setLevainParamWithAudio('a', 'currentArticulation', 'staccato');
        updateMicPosition('a', 0, { volume: 0.31 });
        expect(JSON.stringify(levainStore.value?.b)).toBe(beforeB);
        expect(levainStore.value?.a?.patch).toMatchObject({ masterGain: 0.41, currentArticulation: 'staccato' });
        expect(levainStore.value?.a?.patch.micPositions[0]?.volume).toBe(0.31);
        expect(deviceA.setParam).toHaveBeenCalledWith('current_articulation', expect.any(Number));
        expect(deviceB.setParam).not.toHaveBeenCalled();
        expect(nativeWrite.mock.calls.every(([trackId, deviceId]) => trackId === 'track-a' && deviceId === 'a')).toBe(
            true
        );

        const beforeA = JSON.stringify(levainStore.value?.a);
        bridge.setLevainParamWithAudio('b', 'masterGain', 0.62);
        setCurrentArticulation('b', 'pizzicato');
        updateMicPosition('b', 1, { volume: 0.73 });
        expect(JSON.stringify(levainStore.value?.a)).toBe(beforeA);
        expect(levainStore.value?.b?.patch).toMatchObject({ masterGain: 0.62, currentArticulation: 'pizzicato' });
        expect(levainStore.value?.b?.patch.micPositions[1]?.volume).toBe(0.73);

        for (const frame of frames.splice(0)) {
            frame(0);
        }
        expect(deviceA.setParam).toHaveBeenCalledWith('master_gain', 0.41);
        expect(deviceB.setParam).toHaveBeenCalledWith('master_gain', 0.62);
        expect(persist).toHaveBeenCalledWith('a', expect.any(String), 0.41);
        expect(persist).toHaveBeenCalledWith('b', expect.any(String), 0.62);
        expect(nativeWrite).toHaveBeenCalledWith('track-a', 'a', { master_gain: 0.41 });
        expect(nativeWrite).toHaveBeenCalledWith('track-b', 'b', { master_gain: 0.62 });

        const pendingA = bridge.loadSamplesForInstrument('a', 'cello');
        const pendingB = bridge.loadSamplesForInstrument('b', 'horn');
        bridge.setLevainParamWithAudio('a', 'masterGain', 0.21);
        bridge.setLevainParamWithAudio('b', 'masterGain', 0.82);
        const newerA = channel();
        const newerRegistrationA = bridge.registerLevainDevice('a', deviceA, newerA.port1, vi.fn());
        bridge.unregisterLevainDevice('a', a.port1);
        expect(bridge.readRegistrySizes().activeDevices).toBe(2);
        expect(levainStore.value?.a).toBeDefined();
        expect(loads.at(-1)?.port).toBe(newerA.port1);
        const beforeTeardown = bridge.readRegistrySizes();
        expect(Object.isFrozen(beforeTeardown)).toBe(true);
        expect(beforeTeardown).toMatchObject({
            activeDevices: 2,
            activePorts: 2,
            registrationProgress: 1,
            loadOperations: 2,
            committedBanks: 2,
            latestLoadState: 2,
            pendingKeysByDevice: 2,
            pendingParamBatches: 2,
        });
        deviceA.setParam.mockClear();
        deviceB.setParam.mockClear();
        nativeWrite.mockClear();
        persist.mockClear();
        bridge.unregisterLevainDevice('a', newerA.port1);
        bridge.unregisterLevainDevice('b', b.port1);
        await expect(newerRegistrationA).resolves.toBe('cancelled');
        await expect(pendingA).resolves.toBe('cancelled');
        await expect(pendingB).resolves.toBe('cancelled');
        expect(bridge.readRegistrySizes()).toEqual({
            activeDevices: 0,
            activePorts: 0,
            registrationProgress: 0,
            loadOperations: 0,
            committedBanks: 0,
            latestLoadState: 0,
            pendingKeysByDevice: 0,
            pendingParamBatches: 0,
        });
        for (const frame of frames.splice(0)) {
            frame(0);
        }
        expect(deviceA.setParam).not.toHaveBeenCalled();
        expect(deviceB.setParam).not.toHaveBeenCalled();
        expect(nativeWrite).not.toHaveBeenCalled();
        expect(persist).not.toHaveBeenCalled();
    });
});
