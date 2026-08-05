import { getPluginById } from './DeviceParameter';
import { type DeviceParameter } from './DeviceParameterTypes';

/**
 * What a device parameter's declared contract means at the moment of writing.
 *
 * `automatable` and `minValue`/`maxValue` used to be advisory. `automatable`
 * was read in exactly one place — the picker that offers parameters for a new
 * lane — and the runtime gates that decided whether automation could drive a
 * parameter tested only whether the key was present in `parameterValues`, which
 * it is for anything a panel has ever written. So a lane the UI would refuse to
 * create drove the parameter at full range as soon as it arrived by any other
 * route: a preset, a project file, a stored modulation binding, a model
 * emission. `minValue`/`maxValue` were worse: nothing anywhere clamped a write
 * against them, so narrowing a declared range changed the picker and the
 * modulation depth and nothing else.
 *
 * Both laws live here so there is one definition to read and one to change.
 *
 * Absence of a descriptor means "no declared contract", not "forbidden".
 * Faust devices, hosted plugins and anything with dynamically discovered
 * parameters declare nothing, and their values are still legitimate; both
 * functions therefore pass such a write through untouched. Only a parameter
 * that actually declares a bound is held to it.
 */

type DeviceParameterIdentity = {
    /** `Device.type`, which is matched against `PluginDescriptor.id`. */
    deviceType: string;
    paramId: string;
};

type ClampDeviceParameterValueInput = DeviceParameterIdentity & {
    value: number;
};

function findParameterDescriptor({ deviceType, paramId }: DeviceParameterIdentity): DeviceParameter | undefined {
    return getPluginById(deviceType)?.parameters.find((parameter) => parameter.id === paramId);
}

/**
 * The value a write is actually allowed to land, given the declared range.
 *
 * Clamps rather than rejects. A write that overshoots is a caller bug or stale
 * stored data, and refusing it outright would strand the parameter at whatever
 * it happened to hold; pinning it to the nearest legal value keeps the device
 * usable and keeps the engine's own `_ =>` fallbacks out of the decision.
 */
export function clampDeviceParameterValue({ deviceType, paramId, value }: ClampDeviceParameterValueInput): number {
    const descriptor = findParameterDescriptor({ deviceType, paramId });
    if (!descriptor) {
        return value;
    }

    if (value < descriptor.minValue) {
        return descriptor.minValue;
    }

    if (value > descriptor.maxValue) {
        return descriptor.maxValue;
    }

    return value;
}

/**
 * The member of a declared legal set that a value resolves to.
 *
 * Separate from {@link quantiseDeviceParameterValue} because the set has two
 * consumers and they must not disagree: the delivery path snaps onto it, and a
 * control that offers the set has to know which member is currently in force in
 * order to show it. A control computing that itself is how the two drift.
 *
 * Floors — the greatest member at or below `value`, and the smallest member for
 * anything under it. See {@link quantiseDeviceParameterValue} for why the
 * direction is not "nearest". `legalValues` is required ascending
 * (`DeviceParameterLaw.spec.ts` holds the registry to it), so the scan can
 * stop at the first member above the value.
 */
export function snapToDeclaredLegalValue({
    legalValues,
    value,
}: {
    legalValues: readonly number[];
    value: number;
}): number {
    let snapped = legalValues[0] ?? value;
    for (const legal of legalValues) {
        if (legal > value) {
            break;
        }
        snapped = legal;
    }
    return snapped;
}

/**
 * The value a **delivery** to the DSP is allowed to carry, given the declared
 * type.
 *
 * `float` passes through. `int`, `bool` and `choice` name a parameter whose
 * legal values are the integers in `[minValue, maxValue]` — an oscillator
 * engine index, a filter model, a bit depth, an on/off flag — so a fractional
 * value is not a slightly-wrong setting, it is not a setting at all. The engine
 * either truncates it somewhere in Rust or falls into its `_ =>` arm.
 *
 * **Why this is not folded into {@link clampDeviceParameterValue}.** Two of that
 * function's callers feed its return value straight back in as the state of a
 * one-pole IIR slew — `applyAutomation` (live) and `compileAutomationEvents`
 * (offline), both `smoothed = clamp(slewStep(smoothed, target, α))`. Rounding
 * inside the clamp puts a dead zone in that recurrence: with α = 0.4,
 * `slewStep(5, 6) = 5.4`, which rounds back to 5 on every subsequent tick, so a
 * ride to engine index 6 stalls at 5 and never arrives. The filter has to run in
 * the continuous domain; quantisation is a property of the *delivery*, applied
 * once at the point the value leaves for the DSP. The clamp is also on the
 * persistence path (`persistDeviceParam`, `presetLoading`, `setDeviceParameter`),
 * where rounding would silently rewrite stored project data for every stepped
 * parameter — the exact failure `DeviceParameterTypes` warns about for range.
 *
 * **What this does NOT cover.** Only the delivery path. A value that arrives by
 * a *persistence* route is clamped and not rounded, and that includes the most
 * common hardware route: a learned MIDI CC scales 0..127 across the declared
 * span (`ControlSurface` `scaleMidiValue`) and calls `setDeviceParameter`, so
 * CC 64 on `bacteria/bitDepth` stores and delivers 12.59. That is the same rule
 * as everywhere else here — rounding on a persistence path silently rewrites
 * project data — and it is why `restoreAutomationBaseValue` quantises: the
 * fractional base has to be caught where it *leaves*, not where it is stored.
 * MIDI-FX parameters are not covered either; see `applyAutomation`'s MIDI-FX
 * branch for why that is structural rather than a gap.
 *
 * **Why `Math.round` and not a step grid.** `step` is declared on
 * `PluginParamDef` and is consumed by the descriptor builders to *derive* the
 * type (`step === 1 ? 'int' : 'float'`); it is never copied onto
 * `DeviceParameter`, so no non-unit step survives into the write contract. The
 * params carrying `step: 0.5`, `10` or `100` are all typed `float` and are
 * deliberately continuous here — those steps are knob increments, not a
 * legal-value law. That heuristic used to mis-classify ten logarithmic frequency
 * and time controls that carried `step: 1` as a knob increment; they no longer
 * declare a step at all, and `DeviceParameterLaw.spec.ts` holds the registry to
 * "no logarithmic parameter is stepped" so the next one reds instead of shipping
 * onto a 1 Hz grid.
 *
 * Every parameter that reaches this function as stepped declares integer
 * `minValue` and `maxValue` (asserted over the whole registry in
 * `DeviceParameterLaw.spec.ts`), so rounding to the nearest integer cannot leave
 * the declared range.
 *
 * It does **not** follow that every integer in that range is a distinct legal
 * setting, and a parameter that knows it is not says so with `legalValues`,
 * which this function snaps onto instead of rounding. `crust/oversampling` is
 * the first: it declares 1..32 and legal factors `{1,2,4,8,16,32}`, because its
 * cascade only builds powers of two
 * (`crates/daw-dsp/src/crust/oversample.rs` `normalize_factor`). Measured
 * through the checked-in wasm, the other 26 integers render bit-identical to a
 * neighbour (`dawDspCrustOversampling.spec.ts`).
 *
 * **The snap goes down, not to the nearest.** `normalize_factor` floors, and so
 * does the truncation ahead of it (`engine.rs` `value.max(1.0) as usize`), so
 * flooring here delivers exactly what the engine was already going to use. A
 * nearest-neighbour snap would not: a project storing `oversampling: 30` — a
 * value the 1..32 knob could produce before the legal set was declared — sounds
 * like 16 today, and rounding it up to 32 would change how an existing project
 * renders. The declaration is being corrected; the audio is not.
 *
 * Two parameters in the same shape are still undeclared: `gluten/oversampling`
 * (declared 1..4, legal `{1,2,4}` — `crates/daw-dsp/src/gluten/oversample.rs`
 * `set_rate`, whose `_ => 4` arm swallows 3) and `dutch-oven/algorithm`
 * (declared 0..6, where 4 and 5 are documented reserved wire values that fall
 * through to Plate). For those two the engine still re-snaps a delivered
 * integer itself, so the audible result is a legal setting either way; what is
 * wrong is only the declaration.
 */
export function quantiseDeviceParameterValue({ deviceType, paramId, value }: ClampDeviceParameterValueInput): number {
    const descriptor = findParameterDescriptor({ deviceType, paramId });
    if (!descriptor || descriptor.type === 'float') {
        return value;
    }

    if (descriptor.legalValues) {
        return snapToDeclaredLegalValue({ legalValues: descriptor.legalValues, value });
    }

    const rounded = Math.round(value);
    if (Object.is(rounded, -0)) {
        // `Math.round(-0.2)` is `-0`, and the input is reachable: three stepped
        // parameters declare a negative minimum (`fermenter/oscCoarse` -24..24,
        // `fermenter/oscFine` -100..100, `grinder/gateThreshold` -80..0), so a
        // ride through zero produces it.
        //
        // Nothing downstream is broken by `-0` today — the only comparison on a
        // delivered value is `delivered !== previousDelivered`, and `-0 !== 0`
        // is `false`, so the repeat gate already treats the two as the same
        // value. What this buys is that the function's output is canonical: an
        // index is one number, so a delivered value can be compared, keyed,
        // serialized or read in a log without `-0` and `0` presenting as two
        // different settings for the same index.
        return 0;
    }

    return rounded;
}

/**
 * Whether automation, modulation or a base restore may drive this parameter.
 *
 * This is narrower than "may be written". A knob, a preset or a model action
 * may set a parameter the product declares non-automatable — that is exactly
 * what the flag means, and blocking those would break setting it at all. What
 * the flag forbids is a *curve* driving it over time.
 */
export function isDeviceParameterAutomatable({ deviceType, paramId }: DeviceParameterIdentity): boolean {
    const descriptor = findParameterDescriptor({ deviceType, paramId });
    if (!descriptor) {
        return true;
    }

    return descriptor.automatable;
}
