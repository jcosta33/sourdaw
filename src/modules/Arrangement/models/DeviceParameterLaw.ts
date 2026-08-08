import { getPluginById } from './DeviceParameter';
import { type DeviceParameter, type LegalValueSet } from './DeviceParameterTypes';

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

type SnapToDeclaredLegalValueInput = {
    legalSet: LegalValueSet;
    value: number;
};

/**
 * The member of a declared legal set that an integer resolves to.
 *
 * Not exported past this module. It is the second half of
 * {@link quantiseDeviceParameterValue} and has no independent meaning: it
 * assumes `value` has already been rounded, because the `fallback` resolution
 * asks whether the value *is* a member and a fraction never is. Anything that
 * wants "the setting actually in force" — the delivery path, and the control
 * that has to display it — calls `quantiseDeviceParameterValue`, so there is
 * one answer rather than two that can drift.
 *
 * `values` is required ascending (`DeviceParameterLaw.spec.ts` holds the
 * registry to it), so the `floor` scan can stop at the first member above the
 * value.
 */
function snapToDeclaredLegalValue({ legalSet, value }: SnapToDeclaredLegalValueInput): number {
    if (legalSet.resolution === 'fallback') {
        // Returns the *member*, not the input that matched it. `Math.round`
        // upstream produces `-0` for a ride through zero, and `-0` matches the
        // member `0` here, so returning the input would let `-0` out of a
        // function whose whole job is to answer with a declared setting.
        const member = legalSet.values.find((legal) => legal === value);
        if (member !== undefined) {
            return member;
        }
        return legalSet.fallback;
    }

    let snapped = legalSet.values[0] ?? value;
    for (const legal of legalSet.values) {
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
 * setting, and a parameter that knows it is not says so with a
 * {@link LegalValueSet}, which this function resolves onto **after** rounding.
 * Three declare one today: `crust/oversampling` (1..32, factors
 * `{1,2,4,8,16,32}`), `gluten/oversampling` (1..4, factors `{1,2,4}`) and
 * `dutch-oven/algorithm` (0..6, wire values `{0,1,2,3,6}`).
 *
 * **Rounding comes first, and the order is load-bearing.** This function is
 * the delivery boundary, so the engine only ever sees what it returns; a
 * fraction is resolved here or nowhere. Rounding first means a live automation
 * slew crossing 15.6 on `crust/oversampling` delivers 16, which is exactly what
 * it delivered before any legal set was declared (round to 16, engine keeps
 * 16). Resolving the raw 15.6 instead would deliver 8 — a change in what an
 * existing automation lane sounds like, smuggled in under a declaration fix.
 *
 * **What the resolution direction is for.** It mirrors the engine, it is not a
 * preference: an out-of-set value still arrives from a project file, a preset
 * or a learned MIDI CC by routes that are clamped and not quantised, and the
 * engine resolves those itself. So `crust` floors because `normalize_factor`
 * floors — a project storing `oversampling: 30` has always sounded like 16, and
 * a nearest-member snap would move it to 32. `dutch-oven` falls back because
 * its dispatch is a `match` whose `_ =>` arm is Plate, so its reserved 4 and 5
 * resolve to 0 rather than to the neighbouring Spring. The declaration is being
 * corrected; the audio is not.
 *
 * `DeviceLegalParameterValues.json` holds this to the engines value by value,
 * from both sides: `DeviceLegalParameterValues.spec.ts` here, and
 * `legal_parameter_values.rs` in `daw-dsp` and `proof-chamber`.
 */
export function quantiseDeviceParameterValue({ deviceType, paramId, value }: ClampDeviceParameterValueInput): number {
    const descriptor = findParameterDescriptor({ deviceType, paramId });
    if (!descriptor || descriptor.type === 'float') {
        return value;
    }

    const rounded = Math.round(value);
    if (descriptor.legalSet) {
        // The `-0` canonicalisation below is not repeated here:
        // `snapToDeclaredLegalValue` answers with a member of the declared set
        // in every branch, and a declared set holds `0`, never `-0`.
        return snapToDeclaredLegalValue({ legalSet: descriptor.legalSet, value: rounded });
    }

    if (Object.is(rounded, -0)) {
        // `Math.round(-0.2)` is `-0`, and the input is reachable: two stepped
        // parameters declare a negative minimum (`fermenter/oscCoarse` -24..24
        // and `grinder/gateThreshold` -80..0), so a ride through zero produces
        // it. `fermenter/oscFine` was a third until it stopped declaring a
        // step — cents are continuous in the engine and in every synth that
        // ships a fine-tune control, so it is `float` and never reaches here.
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
