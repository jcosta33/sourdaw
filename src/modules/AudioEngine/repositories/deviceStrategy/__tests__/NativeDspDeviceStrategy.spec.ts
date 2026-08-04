import { describe, it, expect, vi } from 'vitest';

import { NativeDspDeviceStrategy, createNativeDspStrategy } from '../NativeDspDeviceStrategy';

// --- factory tests: mock every engine node creator + predicate so the device-
// type dispatch table in createNativeDspStrategy can be exercised per branch.
const { creators } = vi.hoisted(() => {
    const nodeMock = { workletNode: {} as AudioWorkletNode, ready: Promise.resolve({}) };
    const creators = {
        createFermenterNode: vi.fn((_ctx?: BaseAudioContext, _wasmUrl?: string, _onFault?: (message: string) => void) =>
            Promise.resolve(nodeMock)
        ),
        createToasterNode: vi.fn(() => Promise.resolve(nodeMock)),
        createLevainNode: vi.fn(() => Promise.resolve(nodeMock)),
        createGlutenNode: vi.fn(() => Promise.resolve(nodeMock)),
        createBacteriaNode: vi.fn(() => Promise.resolve(nodeMock)),
        createGrinderNode: vi.fn(() => Promise.resolve(nodeMock)),
        createProofNode: vi.fn(() => Promise.resolve(nodeMock)),
        createProofChamberNode: vi.fn(() => Promise.resolve(nodeMock)),
        createScoringNode: vi.fn(() => Promise.resolve(nodeMock)),
        createGrandBouleNode: vi.fn(
            (_ctx?: BaseAudioContext, _wasmUrl?: string, _onFault?: (message: string) => void) =>
                Promise.resolve(nodeMock)
        ),
        createKneadNode: vi.fn(() => Promise.resolve(nodeMock)),
    };
    return { creators };
});

vi.mock('../../../engine/FermenterNode', () => ({
    isFermenterDevice: (t: string) => t === 'fermenter',
    createFermenterNode: creators.createFermenterNode,
}));
vi.mock('../../../engine/ToasterNode', () => ({
    isToasterDevice: (t: string) => t === 'toaster',
    createToasterNode: creators.createToasterNode,
}));
vi.mock('../../../engine/LevainNode', () => ({
    isLevainDevice: (t: string) => t === 'levain',
    createLevainNode: creators.createLevainNode,
}));
vi.mock('../../../engine/GlutenNode', () => ({
    isGlutenDevice: (t: string) => t === 'gluten',
    createGlutenNode: creators.createGlutenNode,
}));
vi.mock('../../../engine/BacteriaNode', () => ({
    isBacteriaDevice: (t: string) => t === 'bacteria',
    createBacteriaNode: creators.createBacteriaNode,
}));
vi.mock('../../../engine/GrinderNode', () => ({
    isGrinderDevice: (t: string) => t === 'grinder',
    createGrinderNode: creators.createGrinderNode,
}));
vi.mock('../../../engine/ProofNode', () => ({
    isProofDevice: (t: string) => t === 'proof',
    createProofNode: creators.createProofNode,
}));
vi.mock('../../../engine/ProofChamberNode', () => ({
    isProofChamberDevice: (t: string) => t === 'proofChamber',
    createProofChamberNode: creators.createProofChamberNode,
}));
vi.mock('../../../engine/ScoringNode', () => ({
    isScoringDevice: (t: string) => t === 'scoring',
    createScoringNode: creators.createScoringNode,
}));
vi.mock('../../../engine/GrandBouleNode', () => ({
    isGrandBouleDevice: (t: string) => t === 'grandBoule',
    createGrandBouleNode: creators.createGrandBouleNode,
}));
vi.mock('../../../engine/KneadNode', () => ({
    isKneadDevice: (t: string) => t === 'knead',
    createKneadNode: creators.createKneadNode,
}));

type NativeDspNode = ConstructorParameters<typeof NativeDspDeviceStrategy>[0];

function make_dsp_node(overrides: Partial<NativeDspNode> = {}): NativeDspNode {
    return {
        workletNode: {} as AudioWorkletNode,
        ready: Promise.resolve({}),
        ...overrides,
    };
}
describe('NativeDspDeviceStrategy', () => {
    it('should expose input and output as the worklet node', () => {
        const worklet = {} as AudioWorkletNode;
        const dspNode = make_dsp_node({ workletNode: worklet });
        const strategy = new NativeDspDeviceStrategy(dspNode);

        expect(strategy.node.inputNode).toBe(worklet);
        expect(strategy.node.outputNode).toBe(worklet);
        expect(strategy.node.nodes).toEqual([worklet]);
    });

    it('exposes the underlying processor runtime-failure signals', () => {
        const runtimeFailure = new Promise<never>(() => undefined);
        const runtimeHealthCheck = vi.fn(() => Promise.resolve());
        const strategy = new NativeDspDeviceStrategy(make_dsp_node({ runtimeFailure, runtimeHealthCheck }));

        expect(strategy.runtimeFailure).toBe(runtimeFailure);
        expect(strategy.runtimeHealthCheck).toBe(runtimeHealthCheck);
    });

    it('should forward setParam when the underlying node implements it', () => {
        const setParam = vi.fn();
        const strategy = new NativeDspDeviceStrategy(make_dsp_node({ setParam }));

        strategy.setParam('gain', 0.5);
        expect(setParam).toHaveBeenCalledWith('gain', 0.5);
    });

    it('exposes scheduled parameters only when the node provides the complete capability pair', () => {
        const acceptsScheduledParam = vi.fn((name: string) => name === 'mix');
        const scheduleParam = vi.fn();
        const segments = [{ startFrame: 0, endFrame: 128, startValue: 0.2, endValue: 0.8 }];
        const strategy = new NativeDspDeviceStrategy(make_dsp_node({ acceptsScheduledParam, scheduleParam }));

        expect(strategy.acceptsScheduledParam?.('mix')).toBe(true);
        strategy.scheduleParam?.('mix', segments);

        expect(acceptsScheduledParam).toHaveBeenCalledWith('mix');
        expect(scheduleParam).toHaveBeenCalledWith('mix', segments);

        const partial = new NativeDspDeviceStrategy(make_dsp_node({ scheduleParam }));
        expect(partial.acceptsScheduledParam).toBeUndefined();
        expect(partial.scheduleParam).toBeUndefined();
    });

    it('forwards Toaster pad output and dry-ownership controls', () => {
        const connectPadOutput = vi.fn();
        const disconnectPadOutput = vi.fn();
        const setPadDryRouted = vi.fn();
        const strategy = new NativeDspDeviceStrategy(
            make_dsp_node({ connectPadOutput, disconnectPadOutput, setPadDryRouted })
        );
        const destination = {} as AudioNode;

        strategy.connectPadOutput(3, destination);
        strategy.disconnectPadOutput(3, destination);
        strategy.setPadDryRouted(3, true);

        expect(connectPadOutput).toHaveBeenCalledWith(3, destination);
        expect(disconnectPadOutput).toHaveBeenCalledWith(3, destination);
        expect(setPadDryRouted).toHaveBeenCalledWith(3, true);
    });

    it('should not throw when setParam is missing', () => {
        const strategy = new NativeDspDeviceStrategy(make_dsp_node());
        expect(() => strategy.setParam('x', 1)).not.toThrow();
    });

    it('should forward setBypass, noteOn, noteOff, and destroy when present', () => {
        const setBypass = vi.fn();
        const noteOn = vi.fn();
        const noteOff = vi.fn();
        const destroy = vi.fn();
        const strategy = new NativeDspDeviceStrategy(
            make_dsp_node({
                setBypass,
                noteOn,
                noteOff,
                destroy,
            })
        );

        strategy.setBypass(true);
        strategy.noteOn({ noteOrPad: 60, velocity: 100 });
        strategy.noteOn({ noteOrPad: 60, velocity: 100, midiNote: 72, sampleFrame: 480, channel: 3 });
        strategy.noteOff({ noteOrPad: 60, sampleFrame: 960 });
        strategy.destroy();

        expect(setBypass).toHaveBeenCalledWith(true);
        expect(noteOn).toHaveBeenNthCalledWith(1, { noteOrPad: 60, velocity: 100 });
        expect(noteOn).toHaveBeenNthCalledWith(2, {
            noteOrPad: 60,
            velocity: 100,
            midiNote: 72,
            sampleFrame: 480,
            channel: 3,
        });
        expect(noteOff).toHaveBeenCalledWith({ noteOrPad: 60, sampleFrame: 960 });
        expect(destroy).toHaveBeenCalled();
    });

    it('should not throw when optional methods are missing', () => {
        const strategy = new NativeDspDeviceStrategy(make_dsp_node());
        const destination = {} as AudioNode;
        expect(() => strategy.setBypass(false)).not.toThrow();
        expect(() => strategy.noteOn({ noteOrPad: 0, velocity: 0 })).not.toThrow();
        expect(() => strategy.noteOff({ noteOrPad: 0 })).not.toThrow();
        expect(() => strategy.connectPadOutput(0, destination)).not.toThrow();
        expect(() => strategy.disconnectPadOutput(0, destination)).not.toThrow();
        expect(() => strategy.setPadDryRouted(0, false)).not.toThrow();
        expect(() => strategy.destroy()).not.toThrow();
    });

    it('resolveOfflineAutomation returns null when no schedule capability, and a binding when accepted', () => {
        // No scheduleParam at all → null.
        const bare = new NativeDspDeviceStrategy(make_dsp_node());
        expect(bare.resolveOfflineAutomation('mix')).toBeNull();

        // Schedule present but parameter not accepted → null.
        const acceptsScheduledParam = vi.fn((name: string) => name === 'mix');
        const scheduleParam = vi.fn();
        const partial = new NativeDspDeviceStrategy(make_dsp_node({ acceptsScheduledParam, scheduleParam }));
        expect(partial.resolveOfflineAutomation('other')).toBeNull();

        // Accepted → returns a segments binding whose apply forwards to scheduleParam.
        const ok = new NativeDspDeviceStrategy(make_dsp_node({ acceptsScheduledParam, scheduleParam }));
        const binding = ok.resolveOfflineAutomation('mix');
        expect(binding?.kind).toBe('segments');
        const segments = [{ startFrame: 0, endFrame: 128, startValue: 0, endValue: 1 }];
        if (binding?.kind === 'segments') {
            binding.apply(segments);
        }
        expect(scheduleParam).toHaveBeenCalledWith('mix', segments);
    });
});

describe('createNativeDspStrategy factory dispatch', () => {
    const ctx = {} as BaseAudioContext;

    it.each([
        ['fermenter', 'createFermenterNode'],
        ['toaster', 'createToasterNode'],
        ['levain', 'createLevainNode'],
        ['gluten', 'createGlutenNode'],
        ['bacteria', 'createBacteriaNode'],
        ['grinder', 'createGrinderNode'],
        ['proof', 'createProofNode'],
        ['proofChamber', 'createProofChamberNode'],
        ['scoring', 'createScoringNode'],
        ['grandBoule', 'createGrandBouleNode'],
        ['knead', 'createKneadNode'],
    ] as const)('dispatches %s to the matching node creator', async (type, fnName) => {
        for (const [, fn] of Object.entries(creators)) {
            fn.mockClear();
        }
        const strategy = await createNativeDspStrategy(ctx, {
            type,
            parameterValues: { gain: 0.5 },
        } as unknown as ConstructorParameters<typeof NativeDspDeviceStrategy> extends never
            ? never
            : Parameters<typeof createNativeDspStrategy>[1]);
        expect(strategy).toBeInstanceOf(NativeDspDeviceStrategy);
        expect(creators[fnName]).toHaveBeenCalledTimes(1);
    });

    it('throws when the device type is not a native DSP device', async () => {
        await expect(createNativeDspStrategy(ctx, { type: 'unknown', parameterValues: {} } as never)).rejects.toThrow(
            /Failed to create Native DSP device/
        );
    });

    it('does not hand back a strategy before the device reports ready', async () => {
        let settle: (value: Record<string, unknown>) => void = () => {};
        const ready = new Promise<Record<string, unknown>>((resolve) => {
            settle = resolve;
        });
        creators.createFermenterNode.mockResolvedValueOnce({ workletNode: {} as AudioWorkletNode, ready });

        let built = false;
        const pending = (async () => {
            await createNativeDspStrategy(ctx, { type: 'fermenter', parameterValues: {} } as never);
            built = true;
        })();
        await new Promise((resolve) => setTimeout(resolve, 0));
        const beforeReady = built;

        settle({});
        await pending;

        // Every offline device is built through here, and `renderOffline` starts
        // the render as soon as this resolves. Grand Boule's worklet holds no ring
        // buffer until its own `ready` settles, and a render begun before that is
        // total silence which records zero dropouts — so returning early here is
        // the difference between a correct export and an empty one.
        expect({ beforeReady, afterReady: built }).toEqual({ beforeReady: false, afterReady: true });
    });

    it('seeds the strategy with the device parameterValues after ready', async () => {
        const setParam = vi.fn();
        const seeded = { workletNode: {} as AudioWorkletNode, ready: Promise.resolve({}), setParam };
        creators.createFermenterNode.mockResolvedValueOnce(seeded);
        await createNativeDspStrategy(ctx, {
            type: 'fermenter',
            parameterValues: { gain: 0.3, mix: 0.7 },
        } as never);
        expect(setParam).toHaveBeenCalledWith('gain', 0.3);
        expect(setParam).toHaveBeenCalledWith('mix', 0.7);
    });

    it('turns an offline GrandBoule processor fault into a rejected strategy signal', async () => {
        creators.createGrandBouleNode.mockClear();
        const strategy = await createNativeDspStrategy(ctx, {
            type: 'grandBoule',
            parameterValues: {},
        } as never);
        const onFault = creators.createGrandBouleNode.mock.calls[0]?.[2];
        if (!onFault) {
            throw new Error('GrandBoule factory did not register a runtime-failure callback');
        }

        const rejected = expect(strategy.runtimeFailure).rejects.toThrow('offline processor crashed');
        onFault('offline processor crashed');

        await rejected;
    });

    it('turns a post-ready offline Fermenter fault into a rejected strategy signal', async () => {
        creators.createFermenterNode.mockClear();
        const strategy = await createNativeDspStrategy(ctx, {
            type: 'fermenter',
            parameterValues: {},
        } as never);
        const onFault = creators.createFermenterNode.mock.calls[0]?.[2];
        if (!onFault) {
            throw new Error('Fermenter factory did not register a runtime-failure callback');
        }

        const rejected = expect(strategy.runtimeFailure).rejects.toThrow('offline processor crashed');
        onFault('offline processor crashed');

        await rejected;
    });
});
