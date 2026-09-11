import { getLevainEngineParameterName } from '#/modules/Levain/useCases';
import { type NativeDspDeviceType, resolveNativeDspDeviceType } from '#/utils/nativeDspDeviceTypes';

export type NativeBuiltinParameterNameInput = {
    /** Device type, as the body table read it off the project. */
    deviceType: string;
    /** The project-side parameter id a panel or an automation lane authors. */
    paramId: string;
};

/** One body's engine name for a project parameter id, or `null` for an id it does not address. */
type EngineParameterName = (input: { paramId: string }) => string | null;

/**
 * The native-DSP devices whose parameter vocabulary the composition root has
 * to answer for, rather than `nativeBuiltinBodies` stating it itself.
 *
 * `null` is the normal case, and a decision rather than a gap: a body whose
 * vocabulary is a mapper AudioEngine holds — or whose project ids are already
 * the engine's own — needs nothing from here. A module belongs in this table
 * exactly when it writes to the engine directly and therefore imports
 * AudioEngine: reading its map from AudioEngine would close an import cycle,
 * and this is the seam that holds the two apart. The table stays exhaustive
 * over `NativeDspDeviceType` so a new native device fails to compile here
 * until someone decides which side spells its parameters.
 *
 * Ordered to match `NATIVE_DSP_DEVICE_TYPES` so the tables read as one list.
 */
const NATIVE_BUILTIN_PARAMETER_NAMES: Record<NativeDspDeviceType, EngineParameterName | null> = {
    // Its mapper lives in Fermenter, and Fermenter imports no AudioEngine use
    // case, so the body table reads that mapper directly.
    fermenter: null,
    // Kit and pad control writes carry the engine's own names already; the body
    // table maps its `parameterValues` ids through `ToasterKitParamNames.ts`.
    toaster: null,
    // The sampler's panel writes reach the engine through
    // `writeNativeBuiltinParameters`, so Levain imports AudioEngine and its own
    // vocabulary has to arrive from here.
    levain: getLevainEngineParameterName,
    'builtin-crumbs': null,
    'grand-boule': null,
    gluten: null,
    crust: null,
    bacteria: null,
    grinder: null,
    proof: null,
    'dutch-oven': null,
    'native-scoring': null,
    knead: null,
};

/**
 * The engine's own name for one project-side parameter id of a native built-in
 * body, or `null` for an id that body does not address (#3124).
 *
 * Registered as `AudioDeviceRuntimeSink.nativeBuiltinParameterName`. The body
 * table asks through the sink so a device module may deliver its live writes
 * into AudioEngine without AudioEngine importing that module back.
 */
export function nativeBuiltinParameterName(input: NativeBuiltinParameterNameInput): string | null {
    const deviceType = resolveNativeDspDeviceType(input.deviceType);
    if (!deviceType) {
        return null;
    }

    const engineName = NATIVE_BUILTIN_PARAMETER_NAMES[deviceType];
    return engineName ? engineName({ paramId: input.paramId }) : null;
}
