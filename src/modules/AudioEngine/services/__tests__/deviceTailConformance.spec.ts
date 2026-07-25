import { beforeAll, describe, expect, it } from 'vitest';

import { asBaseAudioContext, createMockAudioContext, MockAudioBuffer } from '#/helpers/__tests__/audioContext.mock';
import { getBuiltinPlugins, getPluginById } from '#/modules/Arrangement/useCases';

import { applyParams } from '../../repositories/applyParams';
import { createOfflineDeviceNode } from '../../repositories/deviceNodeFactory';
import { estimateRenderTailSeconds } from '../estimateRenderTailSeconds';

/**
 * OE-9 cross-conformance.
 *
 * `estimateRenderTailSeconds` mirrors `DeviceTailDeclaration` structurally
 * instead of importing it, because a pure service cannot reach into another
 * module's models. That duplication is sanctioned but can drift, so this spec
 * feeds every real descriptor's declaration through the real evaluator.
 *
 * Review round 1 showed the original spec was too weak in two ways, and both
 * gaps hid a real defect:
 *
 *  - it only asked whether a declared tail evaluates non-zero, never whether
 *    the parameter it cites reaches any DSP. `builtin-reverb` cited `rev-decay`,
 *    which no audio node reads, so an "Ambient Wash" preset reserved 8 s of dead
 *    air while a "Tight Room" preset truncated the real 2 s tail;
 *  - it only iterated devices that already declare a tail, so a device that
 *    *lost* its declaration was invisible. The four `builtin-synth` variants
 *    inherit nothing from the base descriptor and silently went back to a tail
 *    of zero.
 *
 * The guards below close both: a declared parameter must demonstrably move the
 * DSP, and a device with a release-like parameter must either declare a tail or
 * be listed as exempt with a reason.
 */

beforeAll(() => {
    // `createReverb` builds its impulse response with `new AudioBuffer(...)`,
    // which jsdom does not provide.
    if (typeof globalThis.AudioBuffer === 'undefined') {
        globalThis.AudioBuffer = MockAudioBuffer as unknown as typeof AudioBuffer;
    }
});

/** Builds the projection `getAutoDetectedTailSeconds` hands to the estimator. */
function tailForDevice(deviceType: string, parameterValues: Record<string, number> = {}): number {
    return estimateRenderTailSeconds([
        {
            devices: [
                {
                    type: deviceType,
                    parameterValues,
                    bypassed: false,
                    tail: getPluginById(deviceType)?.tail,
                },
            ],
        },
    ]);
}

/** Every parameter id a declaration reads, excluding pure constants. */
function citedParameterIds(tail: NonNullable<ReturnType<typeof getPluginById>>['tail']): string[] {
    if (!tail) {
        return [];
    }
    if (tail.kind === 'fixed') {
        return tail.predelayMsParameterId === undefined ? [] : [tail.predelayMsParameterId];
    }
    if (tail.kind === 'decaySeconds') {
        return [tail.parameterId, ...(tail.predelayMsParameterId === undefined ? [] : [tail.predelayMsParameterId])];
    }
    return [tail.loopParameterId, tail.feedbackParameterId];
}

/**
 * Snapshot of every settable audio value on a device node, so a parameter that
 * moves nothing is detectable without knowing the device's internals.
 */
function snapshotNode(nodes: readonly object[]): string {
    return JSON.stringify(
        nodes.map((node) => {
            const entries: Record<string, number> = {};
            for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
                if (typeof value === 'number') {
                    entries[key] = value;
                    continue;
                }
                const audioParam = value as { value?: unknown } | null;
                if (audioParam && typeof audioParam === 'object' && typeof audioParam.value === 'number') {
                    entries[key] = audioParam.value;
                }
            }
            return entries;
        })
    );
}

/**
 * Devices whose DSP runs outside the Web Audio graph (Rust crates, Faust, wasm)
 * cannot be exercised here. Each names where its tail parameter is consumed, so
 * the claim is at least written down and reviewable rather than assumed.
 */
const OFF_GRAPH_TAIL_ATTESTATION: Record<string, string> = {
    'dutch-oven': 'crates/proof-chamber/src/fdn.rs set_param, arm "rt60" | "decay" (see DSP-11)',
    'faust-zita-rev1-reverb': 'src/modules/PluginHost/useCases/faustEngine/dsp/zita-rev1.dsp',
    'faust-spring-reverb': 'src/modules/PluginHost/useCases/faustEngine/dsp/spring-reverb.dsp',
    'faust-tape-delay': 'src/modules/PluginHost/useCases/faustEngine/dsp/tape-delay.dsp',
    fermenter: 'crates/daw-dsp/src/fermenter/layer.rs set_param "amp_release" (ampRelease maps to it)',
    'builtin-crumbs': 'crates/daw-dsp/src/crumbs — native sampler release stage',
    'builtin-synth': 'AudioEngine synth voice envelope (release stage)',
    'builtin-synth-mellotron': 'inherits builtin-synth',
    'builtin-synth-strings': 'inherits builtin-synth',
    'builtin-synth-808bass': 'inherits builtin-synth',
    'builtin-synth-brass': 'inherits builtin-synth',
};

/**
 * Devices carrying a release/decay-shaped parameter that deliberately declare no
 * tail. Each needs a reason, so "we forgot" cannot masquerade as "not needed".
 */
const NO_TAIL_EXEMPTIONS: Record<string, string> = {
    'builtin-compressor': 'release shapes gain recovery, not a sounding tail',
    'builtin-sidechain-compressor': 'release shapes gain recovery, not a sounding tail',
    'builtin-limiter': 'release shapes gain recovery, not a sounding tail',
    'builtin-gate': 'release shapes the gate envelope, not a sounding tail',
    'faust-brick-wall-limiter': 'release shapes gain recovery, not a sounding tail',
    'faust-1176-compressor': 'release shapes gain recovery, not a sounding tail',
    'faust-noise-gate': 'release shapes the gate envelope, not a sounding tail',
    crust: 'limiter release, not a sounding tail',
    proof: 'mastering limiter release, not a sounding tail',
    gluten: 'bus-compressor release, not a sounding tail',
    bacteria: 'per-band dynamics release, not a sounding tail',
    grinder: 'amp/cab model has no decaying tail past its input',
    'builtin-drum-kit': 'one-shot samples end within the rendered region',
    'builtin-drum-machine-808': 'one-shot samples end within the rendered region',
    'builtin-drum-machine-analog': 'one-shot samples end within the rendered region',
    'builtin-drum-machine-electronic': 'one-shot samples end within the rendered region',
    'builtin-drum-machine-acoustic': 'one-shot samples end within the rendered region',
    toaster: 'one-shot drum voices end within the rendered region',
    levain: 'orchestral samples end within the rendered region',
    'grand-boule': 'physical-model ring-out is bounded by its note release',
};

const TAIL_SHAPED_PARAMETER = /^(release|decay|reverb|delay)|(_|-)?(release|decay)$/i;

describe('device tail declarations — descriptor/estimator conformance', () => {
    it('gives every tail-declaring device a non-zero tail at its declared defaults', () => {
        const declaring = getBuiltinPlugins().filter((plugin) => plugin.tail !== undefined);

        // Guards the test itself: if the field were dropped from every
        // descriptor this would be vacuously true.
        expect(declaring.length).toBeGreaterThanOrEqual(8);

        const tailsAtDefaults = declaring.map((plugin) => [plugin.id, tailForDevice(plugin.id)] as const);
        const zeroTails = tailsAtDefaults.filter(([, seconds]) => seconds <= 0);
        expect(zeroTails).toEqual([]);
    });

    it('resolves every declared parameter id against the device that declares it', () => {
        const unresolved: string[] = [];

        for (const plugin of getBuiltinPlugins()) {
            const parameterIds = new Set(plugin.parameters.map((parameter) => parameter.id));
            for (const parameterId of citedParameterIds(plugin.tail)) {
                if (!parameterIds.has(parameterId)) {
                    unresolved.push(`${plugin.id}.${parameterId}`);
                }
            }
        }

        expect(unresolved).toEqual([]);
    });

    it('cites only parameters that actually move the DSP, for every graph-resident device', () => {
        const inert: string[] = [];

        for (const plugin of getBuiltinPlugins()) {
            const cited = citedParameterIds(plugin.tail);
            if (cited.length === 0) {
                continue;
            }

            const context = createMockAudioContext();
            const node = createOfflineDeviceNode({
                context: asBaseAudioContext(context),
                device: {},
                deviceType: plugin.id,
            });
            if (!node) {
                // Not a Web Audio graph device — covered by the attestation test.
                continue;
            }

            for (const parameterId of cited) {
                const declared = plugin.parameters.find((parameter) => parameter.id === parameterId);
                const low = declared?.minValue ?? 0;
                const high = declared?.maxValue ?? 1;

                applyParams(node, plugin.id, { [parameterId]: low });
                const atLow = snapshotNode(node.nodes);
                applyParams(node, plugin.id, { [parameterId]: high });
                const atHigh = snapshotNode(node.nodes);

                if (atLow === atHigh) {
                    inert.push(`${plugin.id}.${parameterId}`);
                }
            }
        }

        // A tail declaration that cites a knob no audio node reads reserves (or
        // truncates) export time on a number the user cannot hear.
        expect(inert).toEqual([]);
    });

    it('records where every off-graph tail parameter is consumed', () => {
        const undocumented: string[] = [];

        for (const plugin of getBuiltinPlugins()) {
            if (!plugin.tail || citedParameterIds(plugin.tail).length === 0) {
                continue;
            }
            const context = createMockAudioContext();
            const isGraphDevice =
                createOfflineDeviceNode({
                    context: asBaseAudioContext(context),
                    device: {},
                    deviceType: plugin.id,
                }) !== null;

            if (!isGraphDevice && OFF_GRAPH_TAIL_ATTESTATION[plugin.id] === undefined) {
                undocumented.push(plugin.id);
            }
        }

        expect(undocumented).toEqual([]);
    });

    it('makes every device with a release-shaped parameter either declare a tail or be exempt', () => {
        const unaccounted: string[] = [];

        for (const plugin of getBuiltinPlugins()) {
            if (plugin.tail !== undefined) {
                continue;
            }
            const hasTailShapedParameter = plugin.parameters.some((parameter) =>
                TAIL_SHAPED_PARAMETER.test(parameter.id)
            );
            if (hasTailShapedParameter && NO_TAIL_EXEMPTIONS[plugin.id] === undefined) {
                unaccounted.push(plugin.id);
            }
        }

        // A device that quietly loses its declaration — as the synth variants
        // did — reads as "no tail" and is truncated on export.
        expect(unaccounted).toEqual([]);
    });

    it('propagates the base declaration to every generated synth variant', () => {
        for (const variantId of [
            'builtin-synth-mellotron',
            'builtin-synth-strings',
            'builtin-synth-808bass',
            'builtin-synth-brass',
        ]) {
            expect(getPluginById(variantId)?.tail, `${variantId} lost its inherited tail`).toEqual(
                getPluginById('builtin-synth')?.tail
            );
        }

        // Analog Strings sets release 1.2 explicitly; it must be reserved.
        expect(tailForDevice('builtin-synth-strings', { release: 1.2 })).toBe(1.2);
    });

    it('declares the built-in reverb tail from its real impulse response, not the inert decay knob', () => {
        // `createReverb` bakes a fixed `sampleRate * 2` impulse response and
        // `applyReverbParams` has no `rev-decay` branch, so the audible tail is
        // 2 s whatever the knob says.
        expect(tailForDevice('builtin-reverb', { 'rev-decay': 8, 'rev-predelay': 0 })).toBe(2);
        expect(tailForDevice('builtin-reverb', { 'rev-decay': 0.3, 'rev-predelay': 0 })).toBe(2);
        // Pre-delay is honoured by the DSP and does shift the tail.
        expect(tailForDevice('builtin-reverb', { 'rev-predelay': 200 })).toBeCloseTo(2.2, 6);
    });

    it('now reserves a tail for devices the old two-device switch ignored', () => {
        expect(tailForDevice('dutch-oven', { decay: 0.8, predelay: 15 })).toBeCloseTo(0.815, 3);
        expect(tailForDevice('faust-zita-rev1-reverb', { decay_time: 7 })).toBe(7);
        expect(tailForDevice('faust-spring-reverb', { decay: 4 })).toBe(4);
        expect(tailForDevice('faust-tape-delay', { delay: 0.4, feedback: 0.5 })).toBeCloseTo(3.986, 3);
        expect(tailForDevice('builtin-convolution-reverb')).toBe(6);
        expect(tailForDevice('builtin-crumbs', { release: 2 })).toBe(2);
    });

    it('leaves devices with no tail declaration at zero', () => {
        expect(tailForDevice('builtin-eq')).toBe(0);
        expect(getPluginById('builtin-eq')?.tail).toBeUndefined();
    });
});
