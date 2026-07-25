import { describe, it, expect } from 'vitest';

import { getBuiltinPlugins, getPluginById } from '#/modules/Arrangement/useCases';

import { estimateRenderTailSeconds } from '../estimateRenderTailSeconds';

/**
 * OE-9 cross-conformance.
 *
 * `estimateRenderTailSeconds` mirrors `DeviceTailDeclaration` structurally
 * instead of importing it, because a pure service cannot reach into another
 * module's models. That duplication is sanctioned but can drift, so this spec
 * feeds every real descriptor's declaration through the real evaluator: a
 * declaration the evaluator no longer understands, or a parameter id that no
 * longer exists on the device, fails here rather than silently returning a
 * zero-length tail on export.
 */

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
            const { tail } = plugin;
            if (!tail || tail.kind === 'fixed') {
                continue;
            }

            const parameterIds = new Set(plugin.parameters.map((parameter) => parameter.id));
            const referenced =
                tail.kind === 'decaySeconds'
                    ? [tail.parameterId, tail.predelayMsParameterId]
                    : [tail.loopParameterId, tail.feedbackParameterId];

            for (const parameterId of referenced) {
                if (parameterId !== undefined && !parameterIds.has(parameterId)) {
                    unresolved.push(`${plugin.id}.${parameterId}`);
                }
            }
        }

        expect(unresolved).toEqual([]);
    });

    it('tracks the stored parameter value for the built-in reverb rather than a constant', () => {
        expect(tailForDevice('builtin-reverb', { 'rev-decay': 5, 'rev-predelay': 0 })).toBe(5);
        expect(tailForDevice('builtin-reverb', { 'rev-decay': 9, 'rev-predelay': 0 })).toBe(9);
    });

    it('now reserves a tail for devices the old two-device switch ignored', () => {
        // Each of these returned exactly 0 before tails were declared, so their
        // reverb/delay/release tails were cut off by every auto-detect export.
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
