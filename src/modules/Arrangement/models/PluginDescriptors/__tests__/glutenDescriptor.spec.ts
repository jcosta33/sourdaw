import { describe, expect, it } from 'vitest';

import { GLUTEN_DESCRIPTOR } from '../GlutenDescriptor';

/**
 * Regression guard: every Gluten parameter the GlutenPanel exposes as an
 * editable control writes to the engine, so each one must also appear in the
 * automation descriptor — otherwise the param is silently non-automatable and
 * absent from the host parameter list. These nine were missing.
 *
 * Source of truth for ranges/defaults: the GlutenPanel controls and the
 * GlutenPatch defaults (Gluten module). Mirrored here because models must not
 * cross module boundaries.
 */
describe('GLUTEN_DESCRIPTOR', () => {
    function byId(id: string) {
        return GLUTEN_DESCRIPTOR.parameters.find((param) => param.id === id);
    }

    // [id, min, max, default] for the nine panel-exposed params that the
    // inventory missed. Defaults match GlutenPatch (booleans encoded as 0).
    const panelExposedParams: ReadonlyArray<readonly [string, number, number, number]> = [
        // 1×, matching `DEFAULT_PATCH.oversampling`. It was 2× on both sides
        // until the panel started gating: a fresh device is a VCA, whose stage
        // is not oversampled, so 2× drew a lit-and-greyed chip claiming a path
        // that does not run. The seven FET and Diode presets state 2×
        // themselves, so none of them changed.
        ['oversampling', 1, 4, 1],
        ['scEqFreq', 20, 20000, 1000],
        ['scEqGain', -18, 18, 0],
        ['scEqQ', 0.1, 10, 1],
        ['scEqEnabled', 0, 1, 0],
        ['jfetK3', 0, 0.5, 0.15],
        ['xfmrK2', 0, 0.3, 0],
        ['vcaType', 0, 2, 1],
        ['extSidechain', 0, 1, 0],
    ];

    it.each(panelExposedParams)(
        'exposes %s as an automatable, host-visible parameter with the panel range',
        (id, min, max, defaultValue) => {
            const param = byId(id);
            expect(param, `${id} must be present in the automation descriptor`).toBeDefined();
            expect(param?.automatable).toBe(true);
            expect(param?.minValue).toBe(min);
            expect(param?.maxValue).toBe(max);
            expect(param?.defaultValue).toBe(defaultValue);
            expect(param?.value).toBe(defaultValue);
        }
    );

    // `style` is a real engine param the bridge pushes (loadGlutenPatchWithAudio)
    // and the engine maps (glutenProcessor PARAM_MAP). It was the sole bridge-pushed
    // key absent from this descriptor, making it invisible to the generic param /
    // automation system. Encoded as an enum index (glue=0..pump=3), default 'glue' = 0.
    it('exposes style as an automatable enum parameter (glue=0..pump=3)', () => {
        const param = byId('style');
        expect(param, 'style must be present in the automation descriptor').toBeDefined();
        expect(param?.automatable).toBe(true);
        expect(param?.minValue).toBe(0);
        expect(param?.maxValue).toBe(3);
        expect(param?.defaultValue).toBe(0);
        expect(param?.type).toBe('int');
    });
});
