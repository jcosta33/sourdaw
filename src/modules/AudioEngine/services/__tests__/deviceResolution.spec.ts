import { describe, it, expect } from 'vitest';

import { asBaseAudioContext, createMockAudioContext } from '../../../../helpers/__tests__/audioContext.mock';
import { COMPRESSOR_AUTO_MAKEUP_TWIN_NODE } from '../../models/DeviceParamLaws';
import { createOfflineDeviceNode } from '../../repositories/deviceNodeFactory';
import { applyBuiltinCompressorParams } from '../../repositories/devices/dynamics/applyCompressorAutoMakeup';
import {
    resolveDeviceCurveWriteTargets,
    resolveDeviceParam,
    resolveDeviceParamTargets,
    resolveDrumKit,
} from '../deviceResolution';

describe('resolveDrumKit', () => {
    it('should return null when no drum kit device is present', () => {
        expect(resolveDrumKit([{ type: 'builtin-gain', parameterValues: {} }])).toBeNull();
    });

    it('should resolve the kit from a builtin-drum-kit device using kit index', () => {
        const kit = resolveDrumKit([{ type: 'builtin-drum-kit', parameterValues: { kit: 0 } }]);
        expect(kit).not.toBeNull();
        expect(kit?.id).toBeDefined();
    });

    it('should treat builtin-drum-machine prefix like a drum kit device', () => {
        const kit = resolveDrumKit([{ type: 'builtin-drum-machine-x', parameterValues: { kitId: 0 } }]);
        expect(kit).not.toBeNull();
    });

    it('should prefer kit from the first matching device in the list', () => {
        const alpha = resolveDrumKit([
            { type: 'builtin-drum-kit', parameterValues: { kit: 0 } },
            { type: 'builtin-drum-kit', parameterValues: { kit: 1 } },
        ]);
        const b = resolveDrumKit([
            { type: 'builtin-drum-kit', parameterValues: { kit: 1 } },
            { type: 'builtin-drum-kit', parameterValues: { kit: 0 } },
        ]);
        expect(alpha?.id).not.toBe(b?.id);
    });
});

describe('resolveDeviceParam', () => {
    it('should resolve builtin-gain gain-level from the first node', () => {
        const gainParam = { value: 0.25 } as AudioParam;
        const gainNode = { gain: gainParam } as GainNode;
        const node = {
            inputNode: gainNode as unknown as AudioNode,
            outputNode: gainNode as unknown as AudioNode,
            nodes: [gainNode as unknown as AudioNode],
        };

        expect(resolveDeviceParam('builtin-gain', 'gain-level', node)).toBe(gainParam);
    });

    it('should return null for an unknown device and parameter id pair', () => {
        const node = {
            inputNode: {} as AudioNode,
            outputNode: {} as AudioNode,
            nodes: [],
        };

        expect(resolveDeviceParam('builtin-gain', 'unknown', node)).toBeNull();
        expect(resolveDeviceParam('unknown-device', 'gain-level', node)).toBeNull();
    });
});

describe('sidechain compressor parameter targets', () => {
    const NAMES = ['threshold', 'ratio', 'attack', 'release', 'makeup'] as const;

    function workletNode() {
        const params = Object.fromEntries(NAMES.map((name) => [name, { value: 0 } as AudioParam]));
        const worklet = { parameters: new Map(Object.entries(params)) } as unknown as AudioWorkletNode;
        const node = { inputNode: worklet, outputNode: worklet, nodes: [worklet as AudioNode] };
        return { node, params };
    }

    it.each([
        ['sc-comp-threshold', 'threshold', 1],
        ['sc-comp-ratio', 'ratio', 1],
        ['sc-comp-attack', 'attack', 1 / 1000],
        ['sc-comp-release', 'release', 1 / 1000],
        ['sc-comp-makeup', 'makeup', 1],
    ])('resolves %s to the worklet %s AudioParam', (parameterId, name, scale) => {
        const { node, params } = workletNode();

        const targets = resolveDeviceParamTargets('builtin-sidechain-compressor', parameterId, node);

        expect(targets).toHaveLength(1);
        expect(targets[0]?.audioParam).toBe(params[name]);
        expect(targets[0]?.scale).toBe(scale);
        expect(targets[0]?.convert).toBeUndefined();
    });

    it('resolves makeup on the degraded gain node with the dB to linear law and nothing else', () => {
        const makeup = { gain: { value: 1 } as AudioParam } as GainNode;
        const node = {
            inputNode: makeup as AudioNode,
            outputNode: makeup as AudioNode,
            nodes: [makeup as AudioNode],
            namedNodes: { makeup: makeup as AudioNode },
        };

        const targets = resolveDeviceParamTargets('builtin-sidechain-compressor', 'sc-comp-makeup', node);

        expect(targets).toHaveLength(1);
        expect(targets[0]?.audioParam).toBe(makeup.gain);
        expect(targets[0]?.convert?.(6)).toBeCloseTo(10 ** (6 / 20), 10);
        for (const id of ['sc-comp-threshold', 'sc-comp-ratio', 'sc-comp-attack', 'sc-comp-release']) {
            expect(resolveDeviceParamTargets('builtin-sidechain-compressor', id, node)).toEqual([]);
        }
    });
});

describe('resolveDeviceCurveWriteTargets', () => {
    it('resolves the limiter ceiling to its own ceiling gain and clipper shaper', () => {
        const node = createOfflineDeviceNode({
            context: asBaseAudioContext(createMockAudioContext()),
            deviceType: 'builtin-limiter',
        });
        if (!node) {
            throw new Error('expected a builtin-limiter offline node');
        }

        const targets = resolveDeviceCurveWriteTargets('builtin-limiter', 'lim-ceiling', node);

        // The pair is the nodes `applyLimiterParams` writes, not copies.
        expect(targets?.ceiling).toBe(node.namedNodes?.ceiling);
        expect(targets?.clipper).toBe(node.namedNodes?.clipper);
    });

    it('resolves nothing for the limiter controls that carry real AudioParams', () => {
        const limiter = createOfflineDeviceNode({
            context: asBaseAudioContext(createMockAudioContext()),
            deviceType: 'builtin-limiter',
        })!;
        const gain = createOfflineDeviceNode({
            context: asBaseAudioContext(createMockAudioContext()),
            deviceType: 'builtin-gain',
        })!;

        expect(resolveDeviceCurveWriteTargets('builtin-limiter', 'lim-threshold', limiter)).toBeNull();
        expect(resolveDeviceCurveWriteTargets('builtin-limiter', 'lim-release', limiter)).toBeNull();
        expect(resolveDeviceCurveWriteTargets('builtin-limiter', 'not-a-parameter', limiter)).toBeNull();
        expect(resolveDeviceCurveWriteTargets('builtin-gain', 'lim-ceiling', gain)).toBeNull();
    });
});

describe('resolveDeviceParamTargets compressor Auto Makeup twin', () => {
    type CompressorParam = 'threshold' | 'ratio' | 'attack' | 'release' | 'knee';

    function createCompressorNode(autoMakeup: 0 | 1) {
        const context = createMockAudioContext();
        const node = createOfflineDeviceNode({
            context: asBaseAudioContext(context),
            deviceType: 'builtin-compressor',
        });
        if (!node) {
            throw new Error('expected a builtin-compressor offline node');
        }
        // The mock's nodes carry a bare context stub; the twin is built from the node's own context.
        Object.defineProperty(node.nodes[0], 'context', { value: context });
        applyBuiltinCompressorParams(node, { 'comp-auto-makeup': autoMakeup });
        return node;
    }

    // Descriptor times are milliseconds; the compressor's are seconds.
    const rows: readonly { parameterId: string; property: CompressorParam; scale: number }[] = [
        { parameterId: 'comp-threshold', property: 'threshold', scale: 1 },
        { parameterId: 'comp-ratio', property: 'ratio', scale: 1 },
        { parameterId: 'comp-attack', property: 'attack', scale: 1 / 1000 },
        { parameterId: 'comp-release', property: 'release', scale: 1 / 1000 },
        { parameterId: 'comp-knee', property: 'knee', scale: 1 },
    ];

    it.each(rows)(
        'targets the compressor and its Auto Makeup twin for $parameterId when Auto Makeup is off',
        ({ parameterId, property, scale }) => {
            const node = createCompressorNode(0);
            const compressor = node.nodes[0] as DynamicsCompressorNode;
            const twin = node.namedNodes?.[COMPRESSOR_AUTO_MAKEUP_TWIN_NODE] as DynamicsCompressorNode | undefined;
            if (!twin) {
                throw new Error('expected Auto Makeup off to build the twin');
            }

            const targets = resolveDeviceParamTargets('builtin-compressor', parameterId, node);

            expect(targets).toHaveLength(2);
            expect(new Set(targets.map((target) => target.audioParam))).toEqual(
                new Set([compressor[property], twin[property]])
            );
            expect(targets.map((target) => [target.scale, target.offset, target.convert])).toEqual([
                [scale, 0, undefined],
                [scale, 0, undefined],
            ]);
        }
    );

    it.each(rows)(
        'targets only the compressor for $parameterId when Auto Makeup is on',
        ({ parameterId, property, scale }) => {
            const node = createCompressorNode(1);
            const compressor = node.nodes[0] as DynamicsCompressorNode;

            expect(node.namedNodes?.[COMPRESSOR_AUTO_MAKEUP_TWIN_NODE]).toBeUndefined();
            const targets = resolveDeviceParamTargets('builtin-compressor', parameterId, node);

            expect(targets).toHaveLength(1);
            expect(targets[0]?.audioParam).toBe(compressor[property]);
            expect(targets[0]?.scale).toBe(scale);
        }
    );
});
