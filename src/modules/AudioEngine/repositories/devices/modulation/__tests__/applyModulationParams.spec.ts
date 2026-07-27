import { describe, expect, it } from 'vitest';

import { asBaseAudioContext, createMockAudioContext } from '../../../../../../helpers/__tests__/audioContext.mock';
import { type OfflineDeviceNode } from '../../types';
import { applyAutoPanParams } from '../applyAutoPanParams';
import { applyFlangerParams } from '../applyFlangerParams';
import { applyPhaserParams } from '../applyPhaserParams';
import { applyStereoWidenerParams } from '../applyStereoWidenerParams';
import { applyTremoloParams } from '../applyTremoloParams';
import { createAutoPan } from '../createAutoPan';
import { createFlanger } from '../createFlanger';
import { createPhaser } from '../createPhaser';
import { createStereoWidener } from '../createStereoWidener';
import { createTremolo } from '../createTremolo';

function param(node: unknown, property: string): { value: number } {
    const candidate = node ? Reflect.get(node, property) : null;
    if (typeof candidate !== 'object' || candidate === null || !('value' in candidate)) {
        throw new Error(`Expected AudioParam at .${property}`);
    }
    return candidate as { value: number };
}

// Build an OfflineDeviceNode that resolves every node through the `dn.nodes[]` fallback
// path (namedNodes omitted), so the `nn?.x ?? dn.nodes[i]` nullish branches are exercised.
function deviceFromNodesOnly(nodes: AudioNode[]): OfflineDeviceNode {
    return {
        inputNode: nodes[0]!,
        outputNode: nodes[nodes.length - 1]!,
        nodes,
    };
}

describe('applyPhaserParams', () => {
    it('applies rate, depth, feedback and high/low stages Q via namedNodes', () => {
        const ctx = createMockAudioContext();
        const device = createPhaser(asBaseAudioContext(ctx));

        applyPhaserParams(device, {
            'phaser-rate': 2.5,
            'phaser-depth': 0.4,
            'phaser-feedback': 0.7,
            'phaser-stages': 8, // > 6 ⇒ Q = 1
        });

        expect(param(device.namedNodes!.lfo, 'frequency').value).toBe(2.5);
        // depth: lfoGain = depth*1000, wet = min(1, depth*0.5+0.25), dry = 1 - wet
        expect(param(device.namedNodes!.lfoGain, 'gain').value).toBe(0.4 * 1000);
        const expectedWet = Math.min(1, 0.4 * 0.5 + 0.25);
        expect(param(device.namedNodes!.wet, 'gain').value).toBe(expectedWet);
        expect(param(device.namedNodes!.dry, 'gain').value).toBe(1 - expectedWet);
        expect(param(device.namedNodes!.feedback, 'gain').value).toBe(0.7);
        for (const key of ['filter0', 'filter1', 'filter2', 'filter3'] as const) {
            expect(param(device.namedNodes![key], 'Q').value).toBe(1); // stages > 6 ⇒ Q 1
        }
        device.dispose?.();
    });

    it('uses Q = 0.5 when stages <= 6 and skips undefined params', () => {
        const ctx = createMockAudioContext();
        const device = createPhaser(asBaseAudioContext(ctx));

        applyPhaserParams(device, { 'phaser-stages': 4 }); // <= 6 ⇒ Q 0.5
        for (const key of ['filter0', 'filter1', 'filter2', 'filter3'] as const) {
            expect(param(device.namedNodes![key], 'Q').value).toBe(0.5);
        }
        device.dispose?.();
    });

    it('resolves nodes through the nodes[] fallback when namedNodes is absent', () => {
        const ctx = createMockAudioContext();
        const base = createPhaser(asBaseAudioContext(ctx));
        // nodes layout: [splitter(0), dry(1), wet(2), filter0(3), filter1(4), filter2(5), filter3(6), lfo(7), lfoGain(8), feedback(9), merger(10)]
        const fallback = deviceFromNodesOnly(base.nodes);

        applyPhaserParams(fallback, {
            'phaser-rate': 3,
            'phaser-depth': 0.6,
            'phaser-feedback': 0.2,
            'phaser-stages': 9,
        });

        // lfo at index 7
        expect(param(fallback.nodes[7], 'frequency').value).toBe(3);
        expect(param(fallback.nodes[8], 'gain').value).toBe(0.6 * 1000);
        const expectedWet = Math.min(1, 0.6 * 0.5 + 0.25);
        // wet is index 2 in fallback resolution (dn.nodes[2])
        expect(param(fallback.nodes[2], 'gain').value).toBe(expectedWet);
        expect(param(fallback.nodes[1], 'gain').value).toBe(1 - expectedWet);
        expect(param(fallback.nodes[9], 'gain').value).toBe(0.2);
        expect(param(fallback.nodes[3], 'Q').value).toBe(1);
    });

    it('leaves values untouched when params object is empty', () => {
        const ctx = createMockAudioContext();
        const device = createPhaser(asBaseAudioContext(ctx));
        const beforeLfo = param(device.namedNodes!.lfo, 'frequency').value;
        applyPhaserParams(device, {});
        expect(param(device.namedNodes!.lfo, 'frequency').value).toBe(beforeLfo);
        device.dispose?.();
    });

    it('stops the LFO and disconnects every unique node exactly once on repeated disposal', () => {
        const ctx = createMockAudioContext();
        const device = createPhaser(asBaseAudioContext(ctx));
        const lfo = device.namedNodes!.lfo as OscillatorNode;

        device.dispose?.();
        device.dispose?.();

        expect(device.dispose).toBeTypeOf('function');
        expect(new Set(device.nodes).size).toBe(device.nodes.length);
        expect(device.nodes).toContain(device.namedNodes!.merger);
        expect(lfo.stop).toHaveBeenCalledTimes(1);
        for (const node of device.nodes) {
            expect(node.disconnect).toHaveBeenCalledTimes(1);
        }
    });
});

describe('applyFlangerParams', () => {
    it('applies rate, depth, feedback and mix via namedNodes', () => {
        const ctx = createMockAudioContext();
        const device = createFlanger(asBaseAudioContext(ctx));

        applyFlangerParams(device, {
            'flanger-rate': 1.2,
            'flanger-depth': 15,
            'flanger-feedback': 0.4,
            'flanger-mix': 0.35,
        });

        expect(param(device.namedNodes!.lfo, 'frequency').value).toBe(1.2);
        expect(param(device.namedNodes!.lfoGain, 'gain').value).toBe(15 / 1000);
        expect(param(device.namedNodes!.delay, 'delayTime').value).toBe(Math.max(0.001, 15 / 1000));
        expect(param(device.namedNodes!.feedback, 'gain').value).toBe(0.4);
        expect(param(device.namedNodes!.wet, 'gain').value).toBe(0.35);
        expect(param(device.namedNodes!.dry, 'gain').value).toBe(1 - 0.35);
        device.dispose?.();
    });

    it('clamps delay time to a 1ms floor on very small depth', () => {
        const ctx = createMockAudioContext();
        const device = createFlanger(asBaseAudioContext(ctx));
        applyFlangerParams(device, { 'flanger-depth': 0.0001 });
        expect(param(device.namedNodes!.delay, 'delayTime').value).toBe(0.001);
        device.dispose?.();
    });

    it('resolves nodes through the nodes[] fallback when namedNodes is absent', () => {
        const ctx = createMockAudioContext();
        const base = createFlanger(asBaseAudioContext(ctx));
        // nodes: [splitter(0), dry(1), wet(2), delay(3), lfo(4), lfoGain(5), feedback(6), merger(7)]
        const fallback = deviceFromNodesOnly(base.nodes);
        applyFlangerParams(fallback, {
            'flanger-rate': 0.8,
            'flanger-depth': 10,
            'flanger-feedback': 0.3,
            'flanger-mix': 0.5,
        });
        expect(param(fallback.nodes[4], 'frequency').value).toBe(0.8);
        expect(param(fallback.nodes[5], 'gain').value).toBe(10 / 1000);
        expect(param(fallback.nodes[3], 'delayTime').value).toBe(Math.max(0.001, 10 / 1000));
        expect(param(fallback.nodes[6], 'gain').value).toBe(0.3);
        expect(param(fallback.nodes[2], 'gain').value).toBe(0.5);
        expect(param(fallback.nodes[1], 'gain').value).toBe(0.5);
    });

    it('leaves values untouched when params object is empty', () => {
        const ctx = createMockAudioContext();
        const device = createFlanger(asBaseAudioContext(ctx));
        const before = param(device.namedNodes!.lfo, 'frequency').value;
        applyFlangerParams(device, {});
        expect(param(device.namedNodes!.lfo, 'frequency').value).toBe(before);
        device.dispose?.();
    });
});

describe('applyAutoPanParams', () => {
    it('applies rate, depth and triangle shape via namedNodes', () => {
        const ctx = createMockAudioContext();
        const device = createAutoPan(asBaseAudioContext(ctx));
        applyAutoPanParams(device, { 'autopan-rate': 4, 'autopan-depth': 0.9, 'autopan-shape': 1 });
        expect(param(device.namedNodes!.lfo, 'frequency').value).toBe(4);
        expect(param(device.namedNodes!.lfoGainL, 'gain').value).toBe(0.9 * 0.5);
        expect(param(device.namedNodes!.lfoGainR, 'gain').value).toBe(-(0.9 * 0.5));
        expect((device.namedNodes!.lfo as OscillatorNode).type).toBe('triangle');
        device.dispose?.();
    });

    it('selects sine shape when shape is not 1', () => {
        const ctx = createMockAudioContext();
        const device = createAutoPan(asBaseAudioContext(ctx));
        applyAutoPanParams(device, { 'autopan-shape': 0 });
        expect((device.namedNodes!.lfo as OscillatorNode).type).toBe('sine');
        device.dispose?.();
    });

    it('resolves nodes through the nodes[] fallback when namedNodes is absent', () => {
        const ctx = createMockAudioContext();
        const base = createAutoPan(asBaseAudioContext(ctx));
        // nodes: [input(0), splitter(1), merger(2), leftGain(3), rightGain(4), lfo(5), lfoGainL(6), lfoGainR(7), output(8)]
        const fallback = deviceFromNodesOnly(base.nodes);
        applyAutoPanParams(fallback, { 'autopan-rate': 2, 'autopan-depth': 0.4, 'autopan-shape': 1 });
        expect(param(fallback.nodes[5], 'frequency').value).toBe(2);
        expect(param(fallback.nodes[6], 'gain').value).toBe(0.4 * 0.5);
        expect(param(fallback.nodes[7], 'gain').value).toBe(-(0.4 * 0.5));
        expect((fallback.nodes[5] as OscillatorNode).type).toBe('triangle');
    });

    it('leaves values untouched when params object is empty', () => {
        const ctx = createMockAudioContext();
        const device = createAutoPan(asBaseAudioContext(ctx));
        const before = param(device.namedNodes!.lfo, 'frequency').value;
        applyAutoPanParams(device, {});
        expect(param(device.namedNodes!.lfo, 'frequency').value).toBe(before);
        device.dispose?.();
    });
});

describe('applyStereoWidenerParams', () => {
    it('applies width, mid (dB→gain) and mono-bass via namedNodes', () => {
        const ctx = createMockAudioContext();
        const device = createStereoWidener(asBaseAudioContext(ctx));
        applyStereoWidenerParams(device, { 'width-amount': 1.5, 'width-mid': -6, 'width-mono-bass': 120 });
        expect(param(device.namedNodes!.sideGain, 'gain').value).toBe(1.5);
        expect(param(device.namedNodes!.midGain, 'gain').value).toBeCloseTo(10 ** (-6 / 20));
        expect(param(device.namedNodes!.monoBassFilter, 'frequency').value).toBe(120);
    });

    it('resolves nodes through the nodes[] fallback when namedNodes is absent', () => {
        const ctx = createMockAudioContext();
        const base = createStereoWidener(asBaseAudioContext(ctx));
        // nodes: [input(0), output(1), splitter(2), merger(3), midSum(4), sideSum(5), rightInvert(6), midGain(7), sideGain(8), monoBassFilter(9), sideInvert(10)]
        const fallback = deviceFromNodesOnly(base.nodes);
        applyStereoWidenerParams(fallback, { 'width-amount': 0.8, 'width-mid': 0, 'width-mono-bass': 80 });
        expect(param(fallback.nodes[8], 'gain').value).toBe(0.8);
        expect(param(fallback.nodes[7], 'gain').value).toBe(10 ** (0 / 20));
        expect(param(fallback.nodes[9], 'frequency').value).toBe(80);
    });

    it('leaves values untouched when params object is empty', () => {
        const ctx = createMockAudioContext();
        const device = createStereoWidener(asBaseAudioContext(ctx));
        const before = param(device.namedNodes!.sideGain, 'gain').value;
        applyStereoWidenerParams(device, {});
        expect(param(device.namedNodes!.sideGain, 'gain').value).toBe(before);
    });
});

describe('applyTremoloParams', () => {
    it('applies rate, depth and square shape via namedNodes', () => {
        const ctx = createMockAudioContext();
        const device = createTremolo(asBaseAudioContext(ctx));
        applyTremoloParams(device, { 'trem-rate': 7, 'trem-depth': 0.6, 'trem-shape': 1 });
        expect(param(device.namedNodes!.lfo, 'frequency').value).toBe(7);
        expect(param(device.namedNodes!.lfoDepth, 'gain').value).toBe(0.6);
        expect((device.namedNodes!.lfo as OscillatorNode).type).toBe('square');
        device.dispose?.();
    });

    it('selects sine shape when shape is not 1', () => {
        const ctx = createMockAudioContext();
        const device = createTremolo(asBaseAudioContext(ctx));
        applyTremoloParams(device, { 'trem-shape': 2 });
        expect((device.namedNodes!.lfo as OscillatorNode).type).toBe('sine');
        device.dispose?.();
    });

    it('resolves nodes through the nodes[] fallback when namedNodes is absent', () => {
        const ctx = createMockAudioContext();
        const base = createTremolo(asBaseAudioContext(ctx));
        // nodes: [input(0), tremGain(1), lfo(2), lfoDepth(3)]
        const fallback = deviceFromNodesOnly(base.nodes);
        applyTremoloParams(fallback, { 'trem-rate': 3, 'trem-depth': 0.2, 'trem-shape': 1 });
        expect(param(fallback.nodes[2], 'frequency').value).toBe(3);
        expect(param(fallback.nodes[3], 'gain').value).toBe(0.2);
        expect((fallback.nodes[2] as OscillatorNode).type).toBe('square');
    });

    it('leaves values untouched when params object is empty', () => {
        const ctx = createMockAudioContext();
        const device = createTremolo(asBaseAudioContext(ctx));
        const before = param(device.namedNodes!.lfo, 'frequency').value;
        applyTremoloParams(device, {});
        expect(param(device.namedNodes!.lfo, 'frequency').value).toBe(before);
        device.dispose?.();
    });
});
