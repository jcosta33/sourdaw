import { beforeEach, describe, it, expect, vi } from 'vitest';

const { strategyMocks } = vi.hoisted(() => ({
    strategyMocks: {
        builtinStrategy: { node: { inputNode: {}, outputNode: {}, nodes: [] }, setParam: vi.fn() },
        nativeStrategy: { node: { inputNode: {}, outputNode: {}, nodes: [] }, setParam: vi.fn() },
    },
}));

vi.mock('../../../engine/FermenterNode', () => ({ isFermenterDevice: vi.fn() }));
vi.mock('../../../engine/ToasterNode', () => ({ isToasterDevice: vi.fn() }));
vi.mock('../../../engine/LevainNode', () => ({ isLevainDevice: vi.fn() }));
vi.mock('../../../engine/GlutenNode', () => ({ isGlutenDevice: vi.fn() }));
vi.mock('../../../engine/BacteriaNode', () => ({ isBacteriaDevice: vi.fn() }));
vi.mock('../../../engine/GrinderNode', () => ({ isGrinderDevice: vi.fn() }));
vi.mock('../../../engine/ProofNode', () => ({ isProofDevice: vi.fn() }));
vi.mock('../../../engine/ProofChamberNode', () => ({ isProofChamberDevice: vi.fn() }));
vi.mock('../../../engine/ScoringNode', () => ({ isScoringDevice: vi.fn() }));
vi.mock('../../../engine/KneadNode', () => ({ isKneadDevice: vi.fn() }));

vi.mock('../WebAudioDeviceStrategy', () => ({
    createWebAudioDevice: vi.fn(() => strategyMocks.builtinStrategy),
}));

vi.mock('../NativeDspDeviceStrategy', () => ({
    createNativeDspStrategy: vi.fn(() => strategyMocks.nativeStrategy),
}));

import { isFermenterDevice } from '../../../engine/FermenterNode';
import { isProofChamberDevice } from '../../../engine/ProofChamberNode';
import { createNativeDspStrategy } from '../NativeDspDeviceStrategy';
import { createDeviceRegistry } from '../setupDeviceStrategies';
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

    it('should create native DSP devices with a custom matcher', async () => {
        vi.mocked(isFermenterDevice).mockReturnValue(true);
        const registry = createDeviceRegistry({
            faustModuleMatcher: () => false,
            createFaustDevice: vi.fn(),
        });
        const ctx = {} as BaseAudioContext;
        const device = createDevice({ type: 'fermenter' });

        const strategy = await registry.createDevice(ctx, device);

        expect(strategy).toBe(strategyMocks.nativeStrategy);
        expect(createNativeDspStrategy).toHaveBeenCalledWith(ctx, device);

        vi.mocked(isFermenterDevice).mockReturnValue(false);
        vi.mocked(isProofChamberDevice).mockReturnValue(true);
        await registry.createDevice(ctx, createDevice({ type: 'proof-chamber' }));

        expect(createNativeDspStrategy).toHaveBeenCalledTimes(2);
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
