import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockAudioContext } from '../../../../helpers/__tests__/audioContext.mock';
import { AdjustmentBusNode } from '../AdjustmentBusNode';

describe('AdjustmentBusNode', () => {
    let ctx: ReturnType<typeof createMockAudioContext>;

    beforeEach(() => {
        ctx = createMockAudioContext();
        vi.clearAllMocks();
    });

    it('creates an EQ bus with an input and output node', () => {
        const bus = new AdjustmentBusNode({
            context: ctx as any,
            effectType: 'eq',
            parameters: { 'High Gain': 6 },
        });

        expect(bus.inputNode).toBeDefined();
        expect(bus.outputNode).toBeDefined();
        expect(ctx.createBiquadFilter).toHaveBeenCalled();
    });

    it('connects a source to the input and tracks it', () => {
        const bus = new AdjustmentBusNode({
            context: ctx as any,
            effectType: 'eq',
            parameters: {},
        });
        const source = ctx.createGain();

        bus.connectSource(source as any);
        expect(source.connect).toHaveBeenCalledWith(bus.inputNode);
        expect(bus.hasSource(source as any)).toBe(true);
    });

    it('connects the output to a destination node', () => {
        const bus = new AdjustmentBusNode({
            context: ctx as any,
            effectType: 'eq',
            parameters: {},
        });
        const dest = ctx.createGain();

        bus.connectDestination(dest as any);
        expect(bus.outputNode.connect).toHaveBeenCalledWith(dest);
    });

    it('setBlend schedules wet and dry ramps inversely', () => {
        const bus = new AdjustmentBusNode({
            context: ctx as any,
            effectType: 'eq',
            parameters: {},
        });

        bus.setBlend(0.7);

        const gainNodes = vi.mocked(ctx.createGain).mock.results.map((r) => r.value);
        const sawWetTarget = gainNodes.some((g) =>
            vi.mocked(g.gain.setTargetAtTime).mock.calls.some((c) => c[0] === 0.7)
        );
        const sawDryTarget = gainNodes.some((g) =>
            vi.mocked(g.gain.setTargetAtTime).mock.calls.some((c) => Math.abs((c[0] as number) - 0.3) < 1e-6)
        );

        expect(sawWetTarget).toBe(true);
        expect(sawDryTarget).toBe(true);
    });

    it('pan effect type uses a StereoPanner and setParams updates it', () => {
        const bus = new AdjustmentBusNode({
            context: ctx as any,
            effectType: 'pan',
            parameters: { Pan: 50 },
        });

        expect(ctx.createStereoPanner).toHaveBeenCalled();

        bus.setParams({ Pan: -100 });
        const lastPanner = vi.mocked(ctx.createStereoPanner).mock.results.at(-1)!.value;
        const calls = vi.mocked(lastPanner.pan.setTargetAtTime).mock.calls;
        expect(calls.at(-1)?.[0]).toBeCloseTo(-1, 3);
    });

    it('disconnects nodes on dispose', () => {
        const bus = new AdjustmentBusNode({
            context: ctx as any,
            effectType: 'eq',
            parameters: {},
        });
        const source = ctx.createGain();
        const dest = ctx.createGain();
        bus.connectSource(source as any);
        bus.connectDestination(dest as any);

        bus.dispose();

        expect(bus.inputNode.disconnect).toHaveBeenCalled();
        expect(bus.outputNode.disconnect).toHaveBeenCalled();
    });

    it('ignores operations after dispose', () => {
        const bus = new AdjustmentBusNode({
            context: ctx as any,
            effectType: 'eq',
            parameters: {},
        });
        bus.dispose();

        const source = ctx.createGain();
        bus.connectSource(source as any);
        expect(bus.hasSource(source as any)).toBe(false);
    });
});
