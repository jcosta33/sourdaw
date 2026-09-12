/**
 * The engine's own name for each Toaster kit-level parameter.
 *
 * Toaster's kit is pushed to the engine as control writes rather than replayed
 * from `parameterValues` (`projectToasterKitToEngineMessages`), and those writes
 * already carry the DSP's snake_case names — `master_gain`, `reverb_mix`, and so
 * on. The worklet's live `param`/`padParam` door (`services/toasterProcessor.ts`)
 * still receives the camelCase ids a panel writes for the kit-level controls
 * (`setToasterKitParam`), so it needs this table to translate them the same way
 * `projectToasterKitToEngineMessages` already does; this file is the one place
 * that table now lives, imported directly by the worklet the way
 * `ToasterAutomationParams.ts` already is — `models/` is the one layer both the
 * worklet and the module runtime may read.
 *
 * Grand Boule's translation (`GrandBouleDspParamNames.ts`) is a *second* copy of
 * a table the worklet keeps its own version of, welded shut by a spec, because
 * that worklet is isolated from `models/` by an older convention. Toaster's
 * worklet already imports `models/` directly, so there is nothing to weld here:
 * one table, one import each side.
 */
export const TOASTER_KIT_PARAM_NAMES: Readonly<Record<string, string>> = {
    masterGain: 'master_gain',
    reverbMix: 'reverb_mix',
    reverbDecay: 'reverb_decay',
    delayTime: 'delay_time',
    delayFeedback: 'delay_feedback',
    delayMix: 'delay_mix',
    swing: 'swing',
    lofiBits: 'lofi_bits',
    lofiRate: 'lofi_rate',
    lofiMix: 'lofi_mix',
};

type MapToasterKitParamToDspParamInput = {
    paramId: string;
};

/** The engine's name for `paramId`, or `null` when the kit addresses no such parameter. */
export function mapToasterKitParamToDspParam(input: MapToasterKitParamToDspParamInput): string | null {
    return TOASTER_KIT_PARAM_NAMES[input.paramId] ?? null;
}
