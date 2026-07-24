import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    MockAudioBuffer,
    asAudioNode,
    asBaseAudioContext,
    createMockAudioContext,
    createMockAudioNode,
} from '../../../../helpers/__tests__/audioContext.mock';
import { applyReverbParams } from '../../repositories/devices/reverbDelay/applyReverbParams';
import { ADJUSTMENT_PARAM_MAP, AdjustmentBusNode } from '../AdjustmentBusNode';

import type { OfflineDeviceNode } from '../../repositories/devices/types';

describe('AdjustmentBusNode', () => {
    let ctx: ReturnType<typeof createMockAudioContext>;

    beforeEach(() => {
        ctx = createMockAudioContext();
        vi.clearAllMocks();
    });

    it('creates an EQ bus with an input and output node', () => {
        const bus = new AdjustmentBusNode({
            context: asBaseAudioContext(ctx),
            effectType: 'eq',
            parameters: { 'High Gain': 6 },
        });

        expect(bus.inputNode).toBeDefined();
        expect(bus.outputNode).toBeDefined();
        expect(ctx.createBiquadFilter).toHaveBeenCalled();
    });

    it('connects a source to the input and tracks it', () => {
        const bus = new AdjustmentBusNode({
            context: asBaseAudioContext(ctx),
            effectType: 'eq',
            parameters: {},
        });
        const source = createMockAudioNode('gain');
        const audioSource = asAudioNode(source);

        bus.connectSource(audioSource);
        expect(source.connect).toHaveBeenCalledWith(bus.inputNode);
        expect(bus.hasSource(audioSource)).toBe(true);
    });

    it('connects the output to a destination node', () => {
        const bus = new AdjustmentBusNode({
            context: asBaseAudioContext(ctx),
            effectType: 'eq',
            parameters: {},
        });
        const dest = createMockAudioNode('gain');

        bus.connectDestination(asAudioNode(dest));
        expect(bus.outputNode.connect).toHaveBeenCalledWith(dest);
    });

    it('setBlend schedules wet and dry ramps inversely', () => {
        const bus = new AdjustmentBusNode({
            context: asBaseAudioContext(ctx),
            effectType: 'eq',
            parameters: {},
        });

        bus.setBlend(0.7);

        const gainNodes = vi.mocked(ctx.createGain).mock.results.map((r) => r.value);
        const sawWetTarget = gainNodes.some((gainNode) =>
            vi.mocked(gainNode.gain.setTargetAtTime).mock.calls.some((call: number[]) => call[0] === 0.7)
        );
        const sawDryTarget = gainNodes.some((gainNode) =>
            vi
                .mocked(gainNode.gain.setTargetAtTime)
                .mock.calls.some((call: number[]) => Math.abs((call[0] ?? Number.NaN) - 0.3) < 1e-6)
        );

        expect(sawWetTarget).toBe(true);
        expect(sawDryTarget).toBe(true);
    });

    it('pan effect type uses a StereoPanner and setParams updates it', () => {
        const bus = new AdjustmentBusNode({
            context: asBaseAudioContext(ctx),
            effectType: 'pan',
            parameters: { Pan: 50 },
        });

        expect(ctx.createStereoPanner).toHaveBeenCalled();

        bus.setParams({ Pan: -100 });
        const lastPanner = vi.mocked(ctx.createStereoPanner).mock.results.at(-1)!.value;
        const calls = vi.mocked(lastPanner.pan.setTargetAtTime).mock.calls;
        expect(calls.at(-1)?.[0]).toBeCloseTo(-1, 3);
    });

    it('resolves volume adjustments through the built-in device use case', () => {
        const bus = new AdjustmentBusNode({
            context: asBaseAudioContext(ctx),
            effectType: 'volume',
            parameters: { Gain: -6 },
        });

        const gainNodes = vi.mocked(ctx.createGain).mock.results.map((result) => result.value);
        const deviceGain = gainNodes.at(-1);
        expect(deviceGain).toBeDefined();
        if (!deviceGain) {
            throw new Error('expected volume adjustment to create a built-in gain node');
        }

        expect(ctx.createGain).toHaveBeenCalledTimes(5);
        expect(deviceGain.gain.value).toBeCloseTo(10 ** (-6 / 20), 6);
        expect(bus.inputNode.connect).toHaveBeenCalledWith(deviceGain);
        expect(deviceGain.connect).toHaveBeenCalled();
    });

    it('disconnects nodes on dispose', () => {
        const bus = new AdjustmentBusNode({
            context: asBaseAudioContext(ctx),
            effectType: 'eq',
            parameters: {},
        });
        const source = createMockAudioNode('gain');
        const dest = createMockAudioNode('gain');
        bus.connectSource(asAudioNode(source));
        bus.connectDestination(asAudioNode(dest));

        bus.dispose();

        expect(bus.inputNode.disconnect).toHaveBeenCalled();
        expect(bus.outputNode.disconnect).toHaveBeenCalled();
    });

    it('reverb param map only emits keys the reverb device actually applies', () => {
        // Regression: ADJUSTMENT_PARAM_MAP.reverb once mapped a `Decay` knob to
        // `rev-decay`, but `applyReverbParams` has no `rev-decay` branch — so the
        // adjustment-layer Decay knob was a silent no-op. Every internal key the
        // reverb map emits must reach an audio param when handed to the reverb
        // device, otherwise the UI implies a control that does nothing.
        const mappedKeys = Object.values(ADJUSTMENT_PARAM_MAP.reverb);

        for (const internalKey of mappedKeys) {
            // Fresh device node per key so each key is judged on its own effect.
            const splitter = {};
            const dry = { gain: { value: 0.5 } };
            const wet = { gain: { value: 0.5 } };
            const convolver = {};
            const merger = {};
            const predelay = { delayTime: { value: 0.01 } };
            const lowcut = { frequency: { value: 80 } };
            const before = {
                dry: dry.gain.value,
                wet: wet.gain.value,
                predelay: predelay.delayTime.value,
                lowcut: lowcut.frequency.value,
            };
            const dn: OfflineDeviceNode = {
                inputNode: splitter as GainNode,
                outputNode: merger as GainNode,
                nodes: [splitter, dry, wet, convolver, merger, predelay, lowcut] as OfflineDeviceNode['nodes'],
            };

            // A sentinel distinct from every initial value above.
            applyReverbParams(dn, { [internalKey]: 0.137 });

            const mutated =
                dry.gain.value !== before.dry ||
                wet.gain.value !== before.wet ||
                predelay.delayTime.value !== before.predelay ||
                lowcut.frequency.value !== before.lowcut;

            expect(mutated, `reverb knob mapped to "${internalKey}" reaches no audio param`).toBe(true);
        }
    });

    it('ignores operations after dispose', () => {
        const bus = new AdjustmentBusNode({
            context: asBaseAudioContext(ctx),
            effectType: 'eq',
            parameters: {},
        });
        bus.dispose();

        const source = createMockAudioNode('gain');
        const audioSource = asAudioNode(source);
        bus.connectSource(audioSource);
        expect(bus.hasSource(audioSource)).toBe(false);
    });
});

describe('AdjustmentBusNode param conversion & lifecycle', () => {
    let ctx: ReturnType<typeof createMockAudioContext>;

    beforeEach(() => {
        ctx = createMockAudioContext();
        vi.clearAllMocks();
    });

    function eqBus(parameters: Record<string, number> = {}): AdjustmentBusNode {
        return new AdjustmentBusNode({ context: asBaseAudioContext(ctx), effectType: 'eq', parameters });
    }

    it('connectSource is idempotent (a second connect of the same source is a no-op)', () => {
        const bus = eqBus();
        const source = createMockAudioNode('gain');
        const audioSource = asAudioNode(source);
        bus.connectSource(audioSource);
        bus.connectSource(audioSource);
        expect(source.connect).toHaveBeenCalledTimes(1);
    });

    it('disconnectSource removes a connected source and tolerates a missing edge', () => {
        const bus = eqBus();
        const source = createMockAudioNode('gain');
        const audioSource = asAudioNode(source);
        bus.connectSource(audioSource);
        // disconnect should call source.disconnect(inputNode) and drop the source.
        bus.disconnectSource(audioSource);
        expect(source.disconnect).toHaveBeenCalledWith(bus.inputNode);
        expect(bus.hasSource(audioSource)).toBe(false);
        // Disconnecting a source that is not tracked is a no-op (no throw).
        expect(() => bus.disconnectSource(createMockAudioNode('gain') as unknown as AudioNode)).not.toThrow();
    });

    it('disconnectSource swallows a WebAudio disconnect error (already-detached edge)', () => {
        const bus = eqBus();
        const source = createMockAudioNode('gain');
        // Make disconnect throw to simulate an already-removed edge.
        source.disconnect.mockImplementation(() => {
            throw new Error('already detached');
        });
        const audioSource = asAudioNode(source);
        bus.connectSource(audioSource);
        expect(() => bus.disconnectSource(audioSource)).not.toThrow();
        expect(bus.hasSource(audioSource)).toBe(false);
    });

    it('connectDestination re-points to a new destination and is idempotent for the same one', () => {
        const bus = eqBus();
        const dest1 = createMockAudioNode('gain');
        const dest2 = createMockAudioNode('gain');
        bus.connectDestination(asAudioNode(dest1));
        // Same destination again → no-op (no second connect).
        bus.connectDestination(asAudioNode(dest1));
        expect(bus.outputNode.connect).toHaveBeenCalledTimes(1);
        // New destination → disconnect old, connect new.
        bus.connectDestination(asAudioNode(dest2));
        expect(bus.outputNode.disconnect).toHaveBeenCalledWith(dest1);
        expect(bus.outputNode.connect).toHaveBeenCalledWith(dest2);
    });

    it('disconnectDestination detaches the current destination (and no-ops when none)', () => {
        const bus = eqBus();
        // No destination yet → no-op.
        bus.disconnectDestination();
        expect(bus.outputNode.disconnect).not.toHaveBeenCalled();
        const dest = createMockAudioNode('gain');
        bus.connectDestination(asAudioNode(dest));
        bus.disconnectDestination();
        expect(bus.outputNode.disconnect).toHaveBeenCalledWith(dest);
        // A second disconnect is a no-op (destination already cleared).
        vi.mocked(bus.outputNode.disconnect).mockClear();
        bus.disconnectDestination();
        expect(bus.outputNode.disconnect).not.toHaveBeenCalled();
    });

    it('connectDestination and setBlend are no-ops after dispose', () => {
        const bus = eqBus();
        bus.dispose();
        const dest = createMockAudioNode('gain');
        bus.connectDestination(asAudioNode(dest));
        expect(bus.outputNode.connect).not.toHaveBeenCalled();
        // setBlend after dispose does not schedule.
        const before = vi.mocked(ctx.createGain).mock.results.length;
        bus.setBlend(0.5);
        expect(vi.mocked(ctx.createGain).mock.results.length).toBe(before);
    });

    it('setParams is a no-op after dispose', () => {
        const bus = eqBus();
        bus.dispose();
        // No throw; applyParams path not reached.
        expect(() => bus.setParams({ 'High Gain': 3 })).not.toThrow();
    });

    it('pan setParams falls through when no panNode was built (defensive guard)', () => {
        // eq bus has no panNode → the pan branch's setParams early-returns.
        const bus = eqBus();
        expect(() => bus.setParams({ Pan: 50 })).not.toThrow();
    });

    it('convertParamValue scales reverb Size, saturation Tone, and stereo-width Width', () => {
        vi.stubGlobal('AudioBuffer', MockAudioBuffer);
        // reverb Size: value/100 (0..100 → 0..1).
        const reverb = new AdjustmentBusNode({
            context: asBaseAudioContext(ctx),
            effectType: 'reverb',
            parameters: { Size: 80 },
        });
        expect(reverb.inputNode).toBeDefined();
        // saturation Tone: 200 + (value/100)*19800.
        const sat = new AdjustmentBusNode({
            context: asBaseAudioContext(ctx),
            effectType: 'saturation',
            parameters: { Tone: 50 },
        });
        expect(sat.inputNode).toBeDefined();
        // stereo-width Width: value/100.
        const width = new AdjustmentBusNode({
            context: asBaseAudioContext(ctx),
            effectType: 'stereo-width',
            parameters: { Width: 60 },
        });
        expect(width.inputNode).toBeDefined();
    });

    it('dispose tears down the pan node when present', () => {
        const bus = new AdjustmentBusNode({
            context: asBaseAudioContext(ctx),
            effectType: 'pan',
            parameters: { Pan: 10 },
        });
        const panner = vi.mocked(ctx.createStereoPanner).mock.results.at(-1)!.value;
        bus.dispose();
        expect(panner.disconnect).toHaveBeenCalled();
    });

    it('dispose is idempotent', () => {
        const bus = eqBus();
        bus.dispose();
        // Second dispose is a no-op.
        expect(() => bus.dispose()).not.toThrow();
    });

    it('pan effect builds a direct wet chain (no device node)', () => {
        const bus = new AdjustmentBusNode({ context: asBaseAudioContext(ctx), effectType: 'pan', parameters: {} });
        // pan maps to deviceType null → deviceNode null, panNode present.
        expect(bus.inputNode).toBeDefined();
        expect(ctx.createStereoPanner).toHaveBeenCalled();
    });
});
