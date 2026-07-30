import { beforeEach, describe, it, expect, vi } from 'vitest';

const { strategyMocks } = vi.hoisted(() => ({
    strategyMocks: {
        builtinStrategy: { node: { inputNode: {}, outputNode: {}, nodes: [] }, setParam: vi.fn() },
        nativeStrategy: { node: { inputNode: {}, outputNode: {}, nodes: [] }, setParam: vi.fn() },
    },
}));

vi.mock('../WebAudioDeviceStrategy', () => ({
    createWebAudioDevice: vi.fn(() => strategyMocks.builtinStrategy),
}));

vi.mock('../NativeDspDeviceStrategy', () => ({
    createNativeDspStrategy: vi.fn(() => strategyMocks.nativeStrategy),
}));

// The registry matcher and the factory dispatch now read one table, so the
// matcher this registry registers is the factory table's own.
// `builtin-crumbs` is here because Crumbs is the one native DSP device whose
// catalog id carries the `builtin-` prefix, which the WebAudio arm matches on.
vi.mock('../nativeDspDeviceFactories', () => ({
    isNativeDspDevice: vi.fn(
        (type: string) => type === 'fermenter' || type === 'dutch-oven' || type === 'builtin-crumbs'
    ),
}));

import { createNativeDspStrategy } from '../NativeDspDeviceStrategy';
import { createDeviceRegistry } from '../setupDeviceStrategies';
import { isUnsupportedDeviceTypeError, type UnsupportedDeviceTypeError } from '../unsupportedDeviceTypeError';
import { createWebAudioDevice } from '../WebAudioDeviceStrategy';

describe('setupDeviceStrategies', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should create built-in web audio devices', async () => {
        const registry = createDeviceRegistry({
            faustModuleMatcher: () => false,
            createFaustDevice: vi.fn(),
        });
        const ctx = {} as BaseAudioContext;
        const device = createDevice({ type: 'builtin-filter' });

        const strategy = await registry.createDevice(ctx, device);

        expect(strategy).toBe(strategyMocks.builtinStrategy);
        expect(createWebAudioDevice).toHaveBeenCalledWith(ctx, device);
    });

    it('should create Faust strategies from the injected matcher and device creator', async () => {
        const setParamValue = vi.fn();
        const faustNode = { setParamValue };
        const offlineNode = {
            inputNode: faustNode as unknown as AudioNode,
            outputNode: faustNode as unknown as AudioNode,
            nodes: [faustNode as unknown as AudioNode],
        };
        const createFaustDevice = vi.fn().mockResolvedValue(offlineNode);
        const registry = createDeviceRegistry({
            faustModuleMatcher: (type) => type === 'faust-x',
            createFaustDevice,
        });
        const ctx = {} as BaseAudioContext;
        const device = createDevice({
            type: 'faust-x',
            parameterValues: { gain: 0.5 },
        });

        const strategy = await registry.createDevice(ctx, device);

        expect(strategy.node).toBe(offlineNode);
        expect(createFaustDevice).toHaveBeenCalledWith({ ctx, faustModuleId: 'faust-x' });
        expect(setParamValue).toHaveBeenCalledWith('gain', 0.5);
    });

    // MD-4 review — the matcher registered here is the strategy module's own,
    // so a device the factory can build can never be one the registry refuses.
    // They used to be two hand-kept lists and `grand-boule` fell through the gap.
    it('routes every device its native strategy claims to that strategy', async () => {
        const registry = createDeviceRegistry({
            faustModuleMatcher: () => false,
            createFaustDevice: vi.fn(),
        });
        const ctx = {} as BaseAudioContext;
        const device = createDevice({ type: 'fermenter' });

        const strategy = await registry.createDevice(ctx, device);

        expect(strategy).toBe(strategyMocks.nativeStrategy);
        expect(createNativeDspStrategy).toHaveBeenCalledWith(ctx, device);

        await registry.createDevice(ctx, createDevice({ type: 'dutch-oven' }));

        expect(createNativeDspStrategy).toHaveBeenCalledTimes(2);
    });

    // `builtin-` is a prefix arm registered ahead of the native one, and
    // `createDevice` stops at the first match, so a native device carrying that
    // prefix would be handed to a WebAudio factory that has no node for it and
    // the export would refuse. Live playback never had that problem —
    // `TrackNode.addDevice` falls through to the wasm registry when the
    // built-in factory returns nothing — so the two dispatches would have
    // disagreed about the same device.
    it('sends a builtin-prefixed native device to the native strategy, not the WebAudio arm', async () => {
        const registry = createDeviceRegistry({
            faustModuleMatcher: () => false,
            createFaustDevice: vi.fn(),
        });
        const ctx = {} as BaseAudioContext;
        const device = createDevice({ type: 'builtin-crumbs' });

        const strategy = await registry.createDevice(ctx, device);

        expect(strategy).toBe(strategyMocks.nativeStrategy);
        expect(createWebAudioDevice).not.toHaveBeenCalled();
    });

    it('refuses a device its native strategy does not claim', async () => {
        const registry = createDeviceRegistry({
            faustModuleMatcher: () => false,
            createFaustDevice: vi.fn(),
        });

        const failure = await registry
            .createDevice({} as BaseAudioContext, createDevice({ type: 'not-a-native-device' }))
            .catch((error: unknown) => error);

        expect(isUnsupportedDeviceTypeError(failure)).toBe(true);
        expect((failure as UnsupportedDeviceTypeError).deviceType).toBe('not-a-native-device');
        expect(createNativeDspStrategy).not.toHaveBeenCalled();
    });
});

function createDevice(overrides: Partial<{ type: string; parameterValues: Record<string, number> }> = {}) {
    return {
        id: 'd1',
        name: 'Device',
        type: 'builtin-device',
        bypassed: false,
        parameterValues: {},
        ...overrides,
    };
}
