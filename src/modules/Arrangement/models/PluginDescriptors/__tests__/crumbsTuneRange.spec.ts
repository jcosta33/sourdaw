import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { BUILTIN_PLUGINS } from '../../DeviceParameter';
import { clampDeviceParameterValue } from '../../DeviceParameterLaw';

/**
 * Three artifacts describe the Crumbs Tune control and, until this file, all
 * three said something different.
 *
 * - The knob in `CrumbsControls.tsx` travels ±24 and reads out `st`.
 * - The descriptor declared ±100 `cents`.
 * - `CrumbsEngine::set_param` clamped to ±2400 into a field named `tune_cents`
 *   — and then never read that field, so the control was inert and none of the
 *   three disagreements ever produced an audible symptom to notice.
 *
 * The declared range is not cosmetic: `clampDeviceParameterValue` is what binds
 * an automation curve (`applyAutomation`), a loaded preset (`presetLoading`)
 * and a direct `setDeviceParameter` write. So a lane drawn on Tune was bounded
 * by a number that agreed with neither the knob nor the engine.
 *
 * Both ends are read out of the files production compiles rather than restated
 * here, so this reds when *either* side drifts — including a well-meant edit
 * that moves only one of them.
 */

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../../../../../../../');

const CRUMBS_ENGINE_SOURCE = 'crates/daw-dsp/src/crumbs/engine.rs';
const CRUMBS_CONTROLS_SOURCE = 'src/modules/Crumbs/presentations/components/CrumbsControls.tsx';

/** Strip line and block comments so prose about the arm cannot be mistaken for it. */
function stripComments(source: string): string {
    return source.replaceAll(/\/\*[\S\s]*?\*\//g, ' ').replaceAll(/\/\/[^\n]*/g, ' ');
}

function readSource(relativePath: string): string {
    return stripComments(readFileSync(join(REPO_ROOT, relativePath), 'utf8'));
}

type EngineTuneArm = {
    readonly minSemitones: number;
    readonly maxSemitones: number;
    /** Semitones → the cents `CrumbsVoice::set_tune` takes. */
    readonly centsPerUnit: number;
};

/**
 * The `CrumbsParam::Tune` arm of `CrumbsEngine::set_param`, as Rust source.
 *
 * The multiplier is captured, not assumed: it is the entire unit claim. A
 * future edit that drops it turns the wire value back into cents while every
 * declared bound still reads ±24, which is precisely the state this file
 * exists to make impossible.
 */
function readEngineTuneArm(): EngineTuneArm {
    const source = readSource(CRUMBS_ENGINE_SOURCE);
    const arm =
        /CrumbsParam::Tune\s*=>\s*self\.tune_cents\s*=\s*value\.clamp\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)\s*\*\s*([\d.]+)/.exec(
            source
        );
    if (!arm) {
        throw new Error(
            `No \`CrumbsParam::Tune\` clamp-and-scale arm found in ${CRUMBS_ENGINE_SOURCE}. ` +
                'If the arm was restructured, update this reader — do not delete the assertions it feeds.'
        );
    }
    return {
        minSemitones: Number(arm[1]),
        maxSemitones: Number(arm[2]),
        centsPerUnit: Number(arm[3]),
    };
}

/**
 * The `min`/`max` props of the Tune knob, as TSX source.
 *
 * The knob is the surface a user actually turns, so it is the third party to
 * the contract. Located by its `label`, because prop order is not a contract.
 */
function readTuneKnobTravel(): { readonly min: number; readonly max: number } {
    const source = readSource(CRUMBS_CONTROLS_SOURCE);
    const knobBlock = source
        .split('<Knob')
        .slice(1)
        .find((block) => block.includes('label="Tune"'));
    if (!knobBlock) {
        throw new Error(`No <Knob label="Tune" … /> found in ${CRUMBS_CONTROLS_SOURCE}.`);
    }
    const min = /min=\{(-?[\d.]+)\}/.exec(knobBlock);
    const max = /max=\{(-?[\d.]+)\}/.exec(knobBlock);
    if (!min || !max) {
        throw new Error(`The Tune knob in ${CRUMBS_CONTROLS_SOURCE} no longer declares literal min/max props.`);
    }
    return { min: Number(min[1]), max: Number(max[1]) };
}

describe('builtin-crumbs tune range', () => {
    const tune = BUILTIN_PLUGINS.find((plugin) => plugin.id === 'builtin-crumbs')?.parameters.find(
        (parameter) => parameter.id === 'tune'
    );

    it('declares the same bounds the engine accepts, in the unit the engine reads', () => {
        const engine = readEngineTuneArm();

        expect(tune?.minValue).toBe(engine.minSemitones);
        expect(tune?.maxValue).toBe(engine.maxSemitones);
        // 100 cents to the semitone. This is what makes `st` the honest unit
        // string and what stops the arm silently reverting to cents.
        expect(engine.centsPerUnit).toBe(100);
        expect(tune?.unit).toBe('st');
    });

    it('declares the same travel the knob offers', () => {
        const knob = readTuneKnobTravel();

        expect(tune?.minValue).toBe(knob.min);
        expect(tune?.maxValue).toBe(knob.max);
    });

    it('binds an over-range automation or preset value to the top of the knob travel', () => {
        // The values are the old declared bounds, which is what a curve authored
        // before this change or a preset saved against it can still carry. Both
        // are outside the new range, so both move — a case parked inside the
        // range would agree with the old ±100 declaration and prove nothing.
        expect(clampDeviceParameterValue({ deviceType: 'builtin-crumbs', paramId: 'tune', value: 100 })).toBe(24);
        expect(clampDeviceParameterValue({ deviceType: 'builtin-crumbs', paramId: 'tune', value: -100 })).toBe(-24);
        // Inside the travel the write is untouched: the clamp must not quantise
        // a knob whose step is 0.1 st.
        expect(clampDeviceParameterValue({ deviceType: 'builtin-crumbs', paramId: 'tune', value: -7.5 })).toBe(-7.5);
    });
});
