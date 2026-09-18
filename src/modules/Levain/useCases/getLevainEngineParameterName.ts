import { createDefaultPatch } from '../models/LevainPatch';

import { getLevainProjectParameterId } from './getLevainProjectParameterId';
import { projectLevainPatchToEngineParameters } from './projectLevainPatchToEngineParameters';

/**
 * The engine name for every project parameter id the patch itself authors.
 *
 * Built by inverting [getLevainProjectParameterId] over the names
 * [projectLevainPatchToEngineParameters] emits, rather than by restating them:
 * that projection is already the one list the worklet registration, the offline
 * setup and the live patch push all read, so a field added to the patch gains
 * its native spelling here without an edit. Inverting the real function is also
 * what makes the round trip exact — `humanize_amount` is spelled `humanize` in
 * project truth, and a hand-written table is where that kind of exception goes
 * to rot.
 */
const PATCH_ENGINE_PARAMETER_NAMES: ReadonlyMap<string, string> = new Map(
    projectLevainPatchToEngineParameters(createDefaultPatch()).map((parameter): [string, string] => [
        getLevainProjectParameterId(parameter.name),
        parameter.name,
    ])
);

/**
 * The engine names for the ids the *descriptor* publishes that the patch does
 * not carry.
 *
 * `LEVAIN_DESCRIPTOR` declares an automation surface wider than the patch —
 * ensemble and divisi behaviour a lane can spell and `LevainEngine::set_param`
 * (`crates/daw-dsp/src/levain/engine.rs`) answers — and those values reach
 * project truth as `parameterValues` entries. The web twin of this table is
 * `PARAM_MAP` in `services/levainProcessor.ts`, which is not importable here
 * (the processor ends in a top-level `registerProcessor`), so the two are
 * hand-welded: every pair below is `PARAM_MAP`'s own, and an id added there
 * must be added here or a natively carried strip will ignore it while the web
 * strip applies it.
 */
const DESCRIPTOR_ENGINE_PARAMETER_NAMES: Readonly<Record<string, string>> = {
    vibratoDepth: 'vibrato_depth',
    autoDivisi: 'auto_divisi',
    autoDivisiSize: 'auto_divisi_size',
    autoArticulation: 'auto_articulation',
    ensembleTiming: 'ensemble_timing',
    attackSpread: 'attack_spread',
    pitchConvergence: 'pitch_convergence',
};

/**
 * The engine's name for one project-side Levain parameter id, or `null` for an
 * id no Levain body addresses (#3124).
 *
 * The inverse of [getLevainProjectParameterId], and the shape
 * `nativeBuiltinBodies`' table mappers take. `null` rather than the id itself
 * for an unknown name: a `write-device-parameter` batch is refused whole over a
 * single key the engine cannot resolve, so a caller deciding whether to admit
 * an automation lane needs the "not addressed" answer rather than a guess.
 */
export function getLevainEngineParameterName({ paramId }: { paramId: string }): string | null {
    return PATCH_ENGINE_PARAMETER_NAMES.get(paramId) ?? DESCRIPTOR_ENGINE_PARAMETER_NAMES[paramId] ?? null;
}
