/**
 * The engine's own name for each Grand Boule parameter a project authors.
 *
 * Grand Boule is spelled twice on the way to the same DSP. A panel, a preset and
 * an automation lane all author the descriptor's camelCase id; `set_param`
 * (`crates/daw-dsp/src/grand_boule/mod.rs`) matches snake_case and answers a
 * name it does not know by doing nothing. On the web path the worklet's
 * `PARAM_MAP` (`worklets/grandBouleEngineCore.ts`) is what closes that gap. The
 * native path has no worklet in it — `GrandBouleBody::set_param`
 * (`crates/daw-engine/src/scheduler.rs`) hands the name straight to the same
 * instance — so it needs the same table, and this is it.
 *
 * One table stated twice is a table that drifts, so
 * `__tests__/grandBouleDspParamNames.spec.ts` pins this one equal to the
 * worklet's. It is deliberately a copy rather than a re-export: `worklets/` is
 * an isolated folder whose files may import nothing but the wasm bindings, and
 * `module-runtime-no-worklet-imports` bars the runtime from reaching back into
 * it. The spec is what makes the copy safe.
 *
 * The set is closed on purpose. `mapGrandBouleParamToDspParam` answers `null`
 * for an id the instrument does not address, which is what lets a caller decide
 * — `readLiveAutomationWrites` drops such a lane rather than sending the engine
 * a write it would silently discard.
 */
export const GRAND_BOULE_DSP_PARAM_NAMES: Readonly<Record<string, string>> = {
    masterGain: 'master_gain',
    soundboardSend: 'soundboard_send',
    sympatheticSend: 'sympathetic_send',
    lidPosition: 'lid_position',
    micPosition: 'mic_position',
    stretchAmount: 'stretch_amount',
    attackBite: 'attack_bite',
    velocityCurve: 'velocity_curve',
    hammerHardnessScale: 'hammer_hardness_scale',
    hammerMassScale: 'hammer_mass_scale',
    soundboardBrightness: 'soundboard_brightness',
    sympatheticLevel: 'sympathetic_level',
    bodyResonance: 'body_resonance',
    toneColor: 'tone_color',
};

type MapGrandBouleParamToDspParamInput = {
    paramId: string;
};

/** The engine's name for `paramId`, or `null` when Grand Boule addresses no such parameter. */
export function mapGrandBouleParamToDspParam(input: MapGrandBouleParamToDspParamInput): string | null {
    return GRAND_BOULE_DSP_PARAM_NAMES[input.paramId] ?? null;
}
