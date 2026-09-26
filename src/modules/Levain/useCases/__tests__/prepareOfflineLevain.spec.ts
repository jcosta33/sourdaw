import { beforeEach, describe, expect, it, vi } from 'vitest';

import { toLevainDeviceState } from '../../models/LevainDeviceState';
import { type MicPositionType } from '../../models/LevainPatch';
import { defaultLevainState, levainStore } from '../../stores/levainStore';
import { captureOfflineLevain } from '../captureOfflineLevain';
import { prepareOfflineLevain } from '../prepareOfflineLevain';

const mocks = vi.hoisted(() => ({
    autoLoadLevainSamples: vi.fn(
        (
            _deviceId: string,
            _port: MessagePort,
            _instrumentId: string,
            _signal?: AbortSignal
        ): Promise<readonly MicPositionType[] | null> => Promise.resolve(null)
    ),
}));

vi.mock('../autoLoadSamples', () => ({
    autoLoadLevainSamples: mocks.autoLoadLevainSamples,
}));

type PostedMessage = { type: string; instrumentId?: string; name?: string; value?: number };

function fakePort(): { port: MessagePort; posted: PostedMessage[] } {
    const posted: PostedMessage[] = [];
    const port = {
        postMessage: (message: PostedMessage) => {
            posted.push(message);
        },
    } as unknown as MessagePort;
    return { port, posted };
}

describe('prepareOfflineLevain', () => {
    beforeEach(() => {
        mocks.autoLoadLevainSamples.mockClear();
        mocks.autoLoadLevainSamples.mockImplementation(() => Promise.resolve(null));
        levainStore.set({});
    });

    it('uses a captured patch after the same device id receives a different live patch', async () => {
        const state = structuredClone(defaultLevainState);
        state.patch.instrumentId = 'cello';
        state.patch.masterGain = 0.37;
        levainStore.set({ 'device-a': state });
        const captured = captureOfflineLevain({ deviceId: 'device-a' });
        state.patch.masterGain = 0.92;
        levainStore.set({ 'device-a': defaultLevainState });
        const { port, posted } = fakePort();

        await prepareOfflineLevain({ deviceId: 'device-a', port, captured });

        expect(posted).toContainEqual({ type: 'param', name: 'master_gain', value: 0.37 });
        expect(mocks.autoLoadLevainSamples).toHaveBeenCalledWith('device-a', port, 'cello', undefined);
    });

    it('hydrates an alternate supplied device without borrowing or writing live owner state', async () => {
        levainStore.set({ 'device-a': defaultLevainState });
        const live = structuredClone(levainStore.value);
        const device = {
            parameterValues: { masterGain: 0.28 },
            deviceState: toLevainDeviceState({ ...defaultLevainState.patch, instrumentId: 'cello' }),
        };
        const captured = captureOfflineLevain({ deviceId: 'device-a', device, state: null });
        device.parameterValues.masterGain = 0.91;
        device.deviceState.data.instrumentId = 'violin-1';
        const { port, posted } = fakePort();

        await prepareOfflineLevain({ deviceId: 'device-a', port, captured });

        expect(posted).toContainEqual({ type: 'param', name: 'master_gain', value: 0.28 });
        expect(mocks.autoLoadLevainSamples).toHaveBeenCalledWith('device-a', port, 'cello', undefined);
        expect(levainStore.value).toEqual(live);
    });

    it('loads the instrument selected by the device patch without mutating the engine first', async () => {
        const { port, posted } = fakePort();
        levainStore.set({
            'device-a': {
                ...defaultLevainState,
                patch: { ...defaultLevainState.patch, instrumentId: 'cello', currentArticulation: 'tremolo' },
            },
        });

        await prepareOfflineLevain({ deviceId: 'device-a', port });

        expect(posted).toContainEqual({ type: 'param', name: 'current_articulation', value: 13 });
        expect(mocks.autoLoadLevainSamples).toHaveBeenCalledWith('device-a', port, 'cello', undefined);
    });

    it('applies the complete numeric patch before the offline sample bank starts loading', async () => {
        const { port, posted } = fakePort();
        const postedWhenLoadStarted: PostedMessage[] = [];
        const patch = {
            ...defaultLevainState.patch,
            masterGain: 0.61,
            currentArticulation: 'tremolo' as const,
            legato: {
                ...defaultLevainState.patch.legato,
                enabled: false,
                adaptiveSpeed: false,
                slowThresholdMs: 410,
                fastThresholdMs: 85,
                portamentoVelocityThreshold: 91,
            },
            humanize: {
                ...defaultLevainState.patch.humanize,
                amount: 0.27,
                timingMaxMs: 9,
                tuningMaxCents: 3,
                dynamicMax: 0.06,
                vibratoVarMax: 0.11,
            },
            expression: {
                ...defaultLevainState.patch.expression,
                dynamicCrossfadeTime: 0.18,
                vibratoRateMin: 3.2,
                vibratoRateMax: 6.4,
                vibratoDepthMax: 18,
                vibratoOnsetDelay: 0.14,
            },
            micPositions: defaultLevainState.patch.micPositions.map((mic, index) => ({
                ...mic,
                volume: [0.2, 0.3, 0.4][index] ?? mic.volume,
                pan: [-0.4, 0, 0.4][index] ?? mic.pan,
                enabled: index !== 1,
            })),
        };
        levainStore.set({ 'device-a': { ...defaultLevainState, patch } });
        mocks.autoLoadLevainSamples.mockImplementation(() => {
            postedWhenLoadStarted.push(...posted);
            return Promise.resolve(null);
        });

        await prepareOfflineLevain({ deviceId: 'device-a', port });

        expect(postedWhenLoadStarted).toEqual([
            { type: 'param', name: 'master_gain', value: 0.61 },
            { type: 'param', name: 'current_articulation', value: 13 },
            { type: 'param', name: 'legato_enabled', value: 0 },
            { type: 'param', name: 'legato_adaptive_speed', value: 0 },
            { type: 'param', name: 'legato_slow_threshold_ms', value: 410 },
            { type: 'param', name: 'legato_fast_threshold_ms', value: 85 },
            { type: 'param', name: 'legato_portamento_velocity_threshold', value: 91 },
            { type: 'param', name: 'humanize_amount', value: 0.27 },
            { type: 'param', name: 'humanize_timing_max_ms', value: 9 },
            { type: 'param', name: 'humanize_tuning_max_cents', value: 3 },
            { type: 'param', name: 'humanize_dynamic_max', value: 0.06 },
            { type: 'param', name: 'humanize_vibrato_var_max', value: 0.11 },
            { type: 'param', name: 'expression_dynamic_crossfade_time', value: 0.18 },
            { type: 'param', name: 'expression_vibrato_rate_min', value: 3.2 },
            { type: 'param', name: 'expression_vibrato_rate_max', value: 6.4 },
            { type: 'param', name: 'expression_vibrato_depth_max', value: 18 },
            { type: 'param', name: 'expression_vibrato_onset_delay', value: 0.14 },
            { type: 'param', name: 'mic_0_volume', value: 0.2 },
            { type: 'param', name: 'mic_0_pan', value: -0.4 },
            { type: 'param', name: 'mic_0_enabled', value: 1 },
            { type: 'param', name: 'mic_1_volume', value: 0.3 },
            { type: 'param', name: 'mic_1_pan', value: 0 },
            { type: 'param', name: 'mic_1_enabled', value: 0 },
            { type: 'param', name: 'mic_2_volume', value: 0.4 },
            { type: 'param', name: 'mic_2_pan', value: 0.4 },
            { type: 'param', name: 'mic_2_enabled', value: 1 },
        ]);
    });

    it('leaves instrument identity and sample-bank replacement in one loader transaction', async () => {
        const { port, posted } = fakePort();
        const postedWhenLoadStarted: PostedMessage[] = [];
        mocks.autoLoadLevainSamples.mockImplementation(() => {
            postedWhenLoadStarted.push(...posted);
            return Promise.resolve(null);
        });

        await prepareOfflineLevain({ deviceId: 'device-a', port });

        expect(postedWhenLoadStarted).toContainEqual({ type: 'param', name: 'current_articulation', value: 0 });
    });

    it('loads the selected instrument into that device port, forwarding the abort signal', async () => {
        const { port } = fakePort();
        const controller = new AbortController();
        levainStore.set({
            'device-a': { ...defaultLevainState, patch: { ...defaultLevainState.patch, instrumentId: 'cello' } },
        });

        await prepareOfflineLevain({ deviceId: 'device-a', port, signal: controller.signal });

        expect(mocks.autoLoadLevainSamples).toHaveBeenCalledWith('device-a', port, 'cello', controller.signal);
    });

    it('falls back to the default instrument for a device with no patch entry', async () => {
        const { port, posted } = fakePort();

        await prepareOfflineLevain({ deviceId: 'never-opened', port });

        expect(posted).toContainEqual({ type: 'param', name: 'current_articulation', value: 0 });
        expect(mocks.autoLoadLevainSamples).toHaveBeenCalledWith(
            'never-opened',
            port,
            defaultLevainState.patch.instrumentId,
            undefined
        );
    });

    it('does not resolve until the zone load has finished', async () => {
        // The reason this matters: an offline context renders faster than real
        // time, so a load that is merely started never lands. Starting it is not
        // enough — the caller must be able to wait for it.
        function ignoreRelease(_value: readonly MicPositionType[] | null): void {}
        let releaseLoad: (value: readonly MicPositionType[] | null) => void = ignoreRelease;
        mocks.autoLoadLevainSamples.mockImplementation(
            () =>
                new Promise<readonly MicPositionType[] | null>((resolve) => {
                    releaseLoad = resolve;
                })
        );

        let settled = false;
        const pending = prepareOfflineLevain({ deviceId: 'device-a', port: fakePort().port }).then(() => {
            settled = true;
            return undefined;
        });

        await Promise.resolve();
        await Promise.resolve();
        expect(settled).toBe(false);

        releaseLoad(null);
        await pending;
        expect(settled).toBe(true);
    });

    it('rejects the offline preparation when the DSP bank cannot be committed', async () => {
        mocks.autoLoadLevainSamples.mockRejectedValueOnce(new Error('bank commit rejected'));

        await expect(prepareOfflineLevain({ deviceId: 'device-a', port: fakePort().port })).rejects.toThrow(
            'bank commit rejected'
        );
    });

    describe('loadedMicPositions ownership — the offline route never writes it', () => {
        // The offline render drives the same loader with the live device's id
        // and an offline render node's port, standing in for the live worklet.
        // Writing `loadedMicPositions` from here would let an export or freeze
        // clear or overwrite the rows the live panel is showing.
        beforeEach(() => {
            levainStore.set({ 'device-a': { ...defaultLevainState, loadedMicPositions: ['close'] } });
        });

        it('leaves the live loadedMicPositions in place when the offline load succeeds', async () => {
            mocks.autoLoadLevainSamples.mockResolvedValueOnce(['decca-tree']);

            await prepareOfflineLevain({ deviceId: 'device-a', port: fakePort().port });

            expect(levainStore.value?.['device-a']?.loadedMicPositions).toEqual(['close']);
        });

        it('leaves the live loadedMicPositions in place when the offline load is aborted', async () => {
            const controller = new AbortController();
            controller.abort();
            mocks.autoLoadLevainSamples.mockResolvedValueOnce(null);

            await prepareOfflineLevain({ deviceId: 'device-a', port: fakePort().port, signal: controller.signal });

            expect(levainStore.value?.['device-a']?.loadedMicPositions).toEqual(['close']);
        });

        it('leaves the live loadedMicPositions in place when the offline load fails', async () => {
            mocks.autoLoadLevainSamples.mockRejectedValueOnce(new Error('offline bank rejected'));

            await expect(
                prepareOfflineLevain({ deviceId: 'device-a', port: fakePort().port })
            ).rejects.toThrow('offline bank rejected');

            expect(levainStore.value?.['device-a']?.loadedMicPositions).toEqual(['close']);
        });
    });
});
