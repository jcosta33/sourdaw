import { describe, expect, it, vi } from 'vitest';

import { getBuiltinPlugins } from '#/modules/Arrangement/useCases';

import {
    asBaseAudioContext,
    createMockAudioContext,
    MockAudioBuffer,
} from '../../../../../helpers/__tests__/audioContext.mock';
import { type AutomationLane } from '../../../models/AutomationViewTypes';
import { resolveDeviceCurveWriteTargets, resolveDeviceParamTargets } from '../../../services/deviceResolution';
import {
    createOfflineDeviceNode,
    BUILTIN_DEVICE_NODE_FACTORIES,
    type OfflineDeviceNode,
} from '../../deviceNodeFactory';
import { WebAudioDeviceStrategy } from '../../deviceStrategy/WebAudioDeviceStrategy';

import { scheduleTrackAutomationFixture } from './scheduleTrackAutomationFixture';

// The convolution-reverb factory renders its bundled impulse with the
// `new AudioBuffer(...)` constructor form, which jsdom omits. Same stub
// offlineDeviceCoverage.spec.ts installs: it adds a capability the
// environment lacks and stands in for no device code.
vi.stubGlobal('AudioBuffer', MockAudioBuffer);

/**
 * Controls whose DSP has no AudioParam home and no frame-addressed write. Each
 * row is a reasoned structural exception (issue #3739), not a silent drop: the
 * parameter drives a rendered buffer or curve, which automation cannot schedule
 * onto.
 */
const STRUCTURAL_EXCEPTIONS: Readonly<Record<string, string>> = {
    // The reverb tail IS the rendered impulse; these re-render it.
    'builtin-reverb:rev-size': 'impulse re-render, no AudioParam',
    'builtin-reverb:rev-decay': 'impulse re-render, no AudioParam',
    'builtin-reverb:rev-damping': 'impulse re-render, no AudioParam',
    // WaveShaper curve regeneration.
    'builtin-distortion:dist-drive': 'WaveShaper curve regeneration, no AudioParam',
    'builtin-bitcrusher:crush-bits': 'WaveShaper curve regeneration, no AudioParam',
    // Bound to the rate decimator worklet's `rate` AudioParam (node 5,
    // parameters map) — production engages it wherever the worklet module has
    // loaded; this census's worklet double registers no processor, so its
    // AudioParamMap is empty here. The static applier skips the same absent
    // param, so live and offline degrade identically.
    'builtin-bitcrusher:crush-rate': 'optional worklet param, absent from the census double',
};

function makeLane(overrides: Partial<AutomationLane>): AutomationLane {
    return {
        id: overrides.id ?? 'lane-1',
        trackId: overrides.trackId ?? 'track-1',
        clipId: overrides.clipId,
        parameterId: overrides.parameterId ?? 'gain',
        parameterName: overrides.parameterName ?? 'Gain',
        points: overrides.points ?? [],
        enabled: overrides.enabled ?? true,
        minValue: overrides.minValue ?? 0,
        maxValue: overrides.maxValue ?? 1,
    };
}

function namedGain(node: OfflineDeviceNode, name: string): GainNode {
    const named = node.namedNodes?.[name];
    if (!named) {
        throw new Error(`expected a named ${name} node`);
    }
    return named as GainNode;
}

/** The mock param's ramp values, read through its vitest mock. */
function rampValues(param: AudioParam): number[] {
    const calls = (param as unknown as { linearRampToValueAtTime: { mock: { calls: [number, number][] } } })
        .linearRampToValueAtTime.mock.calls;
    return calls.map((call) => call[0]);
}

describe('offline automation binding census (#3739)', () => {
    it('resolves every descriptor-automatable control of every Web Audio device, or carries a reasoned structural exception', () => {
        const plugins = getBuiltinPlugins();
        let covered = 0;
        let exempt = 0;
        const coveredPairs: string[] = [];

        for (const factory of BUILTIN_DEVICE_NODE_FACTORIES) {
            const descriptor = plugins.find((plugin) => plugin.id === factory.type);
            // A factory without a descriptor would sit outside the range law
            // and the automatable law at once — it must be visible here.
            expect(descriptor, `no descriptor for ${factory.type}`).toBeDefined();
            const node = createOfflineDeviceNode({
                context: asBaseAudioContext(createMockAudioContext()),
                deviceType: factory.type,
            });
            if (!node) {
                throw new Error(`expected ${factory.type} to build offline`);
            }
            for (const parameter of descriptor!.parameters) {
                if (!parameter.automatable) {
                    continue;
                }
                const pair = `${factory.type}:${parameter.id}`;
                const targets = resolveDeviceParamTargets(factory.type, parameter.id, node);
                const curveTargets = resolveDeviceCurveWriteTargets(factory.type, parameter.id, node);
                if (targets.length > 0 || curveTargets !== null) {
                    covered += 1;
                    coveredPairs.push(pair);
                    expect(STRUCTURAL_EXCEPTIONS[pair], `${pair} binds but still carries an exemption`).toBeUndefined();
                    continue;
                }
                exempt += 1;
                expect(STRUCTURAL_EXCEPTIONS[pair], `${pair} resolves no binding and no exemption`).toBeDefined();
            }
            node.dispose?.();
        }

        // Presence pins (ADR 0015 rule 4): a walk that went blind reaches zero
        // and cannot produce these counts. 70 automatable pairs across the 19
        // Web Audio device descriptors, 64 of them bound — 63 to real AudioParams
        // and the limiter ceiling to its frame-addressed curve write (#4437);
        // the six structural exceptions above account for the rest. Binding a
        // previously exempt control moves both numbers by the same amount.
        expect(covered).toBe(64);
        expect(exempt).toBe(6);
        // The issue's named examples are individually bound, not just counted.
        for (const pair of [
            'builtin-eq:eq-low-q',
            'builtin-eq:eq-high-q',
            'builtin-compressor:comp-knee',
            'builtin-chorus:chorus-mix',
            'builtin-delay:delay-lowcut',
            'builtin-delay:delay-highcut',
            'builtin-deesser:deess-threshold',
            'builtin-deesser:deess-freq',
            'builtin-deesser:deess-range',
        ]) {
            expect(coveredPairs).toContain(pair);
        }
    });

    it('binds lim-ceiling as a frame-addressed curve write, not as an AudioParam', () => {
        const node = createOfflineDeviceNode({
            context: asBaseAudioContext(createMockAudioContext()),
            deviceType: 'builtin-limiter',
        });
        if (!node) {
            throw new Error('expected a builtin-limiter offline node');
        }
        // Automation cannot move the cap through an AudioParam — the advertised
        // cap lives in the clipper's WaveShaper curve — so the pair resolves the
        // ceiling and the shaper themselves, and the scheduler rebuilds the
        // curve at every automation frame (#4437).
        expect(resolveDeviceParamTargets('builtin-limiter', 'lim-ceiling', node)).toHaveLength(0);
        const curveTargets = resolveDeviceCurveWriteTargets('builtin-limiter', 'lim-ceiling', node);
        expect(curveTargets?.ceiling).toBe(node.namedNodes?.ceiling);
        expect(curveTargets?.clipper).toBe(node.namedNodes?.clipper);
        // The statically-applied limiter controls stay bound to their params.
        expect(resolveDeviceParamTargets('builtin-limiter', 'lim-threshold', node)).toHaveLength(1);
        expect(resolveDeviceParamTargets('builtin-limiter', 'lim-release', node)).toHaveLength(1);
        node.dispose?.();
    });

    it('resolves the issue’s named drops to their real AudioParams', () => {
        const context = asBaseAudioContext(createMockAudioContext());
        const eq = createOfflineDeviceNode({ context, deviceType: 'builtin-eq' })!;
        const comp = createOfflineDeviceNode({ context, deviceType: 'builtin-compressor' })!;
        const chorus = createOfflineDeviceNode({ context, deviceType: 'builtin-chorus' })!;
        const delay = createOfflineDeviceNode({ context, deviceType: 'builtin-delay' })!;
        expect(resolveDeviceParamTargets('builtin-eq', 'eq-low-q', eq)[0]?.audioParam).toBe(
            (eq.nodes[0] as BiquadFilterNode).Q
        );
        expect(resolveDeviceParamTargets('builtin-eq', 'eq-high-q', eq)[0]?.audioParam).toBe(
            (eq.nodes[2] as BiquadFilterNode).Q
        );
        expect(resolveDeviceParamTargets('builtin-compressor', 'comp-knee', comp)[0]?.audioParam).toBe(
            (comp.nodes[0] as DynamicsCompressorNode).knee
        );
        expect(resolveDeviceParamTargets('builtin-chorus', 'chorus-mix', chorus).map((t) => t.audioParam)).toEqual([
            namedGain(chorus, 'wet').gain,
            namedGain(chorus, 'dry').gain,
        ]);
        expect(resolveDeviceParamTargets('builtin-delay', 'delay-lowcut', delay)[0]?.audioParam).toBe(
            (delay.nodes[6] as BiquadFilterNode).frequency
        );
        expect(resolveDeviceParamTargets('builtin-delay', 'delay-highcut', delay)[0]?.audioParam).toBe(
            (delay.nodes[7] as BiquadFilterNode).frequency
        );
    });

    it('binds rev-mix to both taps of applyReverbParams’ wet/dry law', () => {
        const node = createOfflineDeviceNode({
            context: asBaseAudioContext(createMockAudioContext()),
            deviceType: 'builtin-reverb',
        });
        if (!node) {
            throw new Error('expected a builtin-reverb offline node');
        }
        const targets = resolveDeviceParamTargets('builtin-reverb', 'rev-mix', node);
        const wetGain = namedGain(node, 'wet').gain;
        const dryGain = namedGain(node, 'dry').gain;
        expect(targets).toHaveLength(2);
        expect(targets[0]?.audioParam).toBe(wetGain);
        expect(targets[0]?.scale).toBe(1);
        expect(targets[1]?.audioParam).toBe(dryGain);
        // dry = 1 − mix, exactly the static applier's law.
        expect(targets[1]?.scale).toBe(-1);
        expect(targets[1]?.offset).toBe(1);
    });

    it('renders a 100% wet rev-mix lane with the dry tap silent', () => {
        const node = createOfflineDeviceNode({
            context: asBaseAudioContext(createMockAudioContext()),
            deviceType: 'builtin-reverb',
        });
        if (!node) {
            throw new Error('expected a builtin-reverb offline node');
        }
        scheduleTrackAutomationFixture({
            lanes: [
                makeLane({
                    parameterId: 'device-1:rev-mix',
                    minValue: 0,
                    maxValue: 1,
                    points: [
                        { beat: 128, value: 0.3, curve: 'linear', tension: 0 },
                        { beat: 130, value: 1, curve: 'linear', tension: 0 },
                    ],
                }),
            ],
            trackId: 'track-1',
            trackGainNode: { gain: { setValueAtTime: () => {} } } as unknown as GainNode,
            trackPanNode: { pan: { setValueAtTime: () => {} } } as unknown as StereoPannerNode,
            deviceEntries: [
                {
                    deviceId: 'device-1',
                    deviceType: 'builtin-reverb',
                    strategy: new WebAudioDeviceStrategy(node, 'builtin-reverb'),
                },
            ],
            durationSeconds: 10,
            defaultTempo: 120,
            changes: [],
            regionStartSeconds: 64,
        });
        const wetRamps = rampValues(namedGain(node, 'wet').gain);
        const dryRamps = rampValues(namedGain(node, 'dry').gain);
        // The mix rides to fully wet: the wet lane arrives at 1 and the dry
        // lane — bound since #3739 — arrives at 0 instead of freezing at its
        // pre-render level.
        expect(wetRamps.at(-1)).toBeCloseTo(1, 9);
        expect(dryRamps.at(-1)).toBeCloseTo(0, 9);
    });
});
