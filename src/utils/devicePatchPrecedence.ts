import { projectBacteriaParameters } from './bacteriaParameterReplay';
import { type BuiltinDeviceType, resolveBuiltinDeviceType } from './builtinDeviceTypes';
import { resolveNativeDspDeviceType } from './nativeDspDeviceTypes';

type ParameterValues = Record<string, number> | Readonly<Record<string, number>>;

type ReplayOrder = (parameterValues: ParameterValues) => Array<[string, number]>;

const TOASTER_ENGINE_TYPE_KEYS: readonly string[] = Array.from({ length: 16 }, (_, pad) => `pad${pad}_engine_type`);

function replayInInsertionOrder(parameterValues: ParameterValues): Array<[string, number]> {
    return Object.entries(parameterValues);
}

function replayPrecedenceFirst(precedence: readonly string[]): ReplayOrder {
    const precedenceSet = new Set(precedence);
    return (parameterValues) => {
        const leading: Array<[string, number]> = [];
        for (const key of precedence) {
            if (Object.hasOwn(parameterValues, key)) {
                const value = parameterValues[key];
                if (value !== undefined) {
                    leading.push([key, value]);
                }
            }
        }
        const rest = Object.entries(parameterValues).filter(([key]) => !precedenceSet.has(key));
        return [...leading, ...rest];
    };
}

function replayBacteriaProjection(parameterValues: ParameterValues): Array<[string, number]> {
    return Object.entries(projectBacteriaParameters(parameterValues));
}

/**
 * Ordering laws for native device parameters when replaying a device's patch.
 *
 * Mirrors the native body laws in `crates/daw-engine/src/scheduler.rs`:
 * - Crust: `CRUST_PATCH_PRECEDENCE` (`style` first, so exact `algorithm` pick lands last).
 * - Gluten: `GLUTEN_MACRO_KEYS` (`style`, `topology`, `amount` — `style` leads
 *   because the engine's style write also selects the style's own topology, so
 *   an explicit `topology` entry must land after it to win).
 * - Grinder: `GRINDER_PATCH_PRECEDENCE` (`neuralEnabled`).
 * - Fermenter: `LAYER_ROUTING_KEY` (`activeLayer` / `active_layer`).
 * - Toaster: `TOASTER_PATCH_PRECEDENCE` (`pad0_engine_type` ... `pad15_engine_type`).
 * - Bacteria: projects saved band overrides and crossovers instead of ordering keys.
 *
 * Every built-in type has exactly one row, so a new device type fails compilation
 * until its replay order is decided (ADR 0063).
 */
export const PATCH_REPLAY_BY_TYPE: { readonly [Type in BuiltinDeviceType]: ReplayOrder } = {
    'builtin-eq': replayInInsertionOrder,
    'builtin-compressor': replayInInsertionOrder,
    'builtin-reverb': replayInInsertionOrder,
    'builtin-delay': replayInInsertionOrder,
    'builtin-gain': replayInInsertionOrder,
    'builtin-sidechain-compressor': replayInInsertionOrder,
    'builtin-chorus': replayInInsertionOrder,
    'builtin-phaser': replayInInsertionOrder,
    'builtin-distortion': replayInInsertionOrder,
    'builtin-limiter': replayInInsertionOrder,
    'builtin-flanger': replayInInsertionOrder,
    'builtin-tremolo': replayInInsertionOrder,
    'builtin-bitcrusher': replayInInsertionOrder,
    'builtin-filter': replayInInsertionOrder,
    'builtin-autopan': replayInInsertionOrder,
    'builtin-convolution-reverb': replayInInsertionOrder,
    'builtin-stereo-widener': replayInInsertionOrder,
    'builtin-deesser': replayInInsertionOrder,
    'builtin-lufs-meter': replayInInsertionOrder,
    'builtin-synth': replayInInsertionOrder,
    'builtin-synth-mellotron': replayInInsertionOrder,
    'builtin-synth-strings': replayInInsertionOrder,
    'builtin-synth-808bass': replayInInsertionOrder,
    'builtin-synth-brass': replayInInsertionOrder,
    'builtin-drum-kit': replayInInsertionOrder,
    'builtin-drum-machine-808': replayInInsertionOrder,
    'builtin-drum-machine-analog': replayInInsertionOrder,
    'builtin-drum-machine-electronic': replayInInsertionOrder,
    'builtin-drum-machine-acoustic': replayInInsertionOrder,
    fermenter: replayPrecedenceFirst(['activeLayer', 'active_layer']),
    toaster: replayPrecedenceFirst(TOASTER_ENGINE_TYPE_KEYS),
    levain: replayInInsertionOrder,
    'builtin-crumbs': replayInInsertionOrder,
    'grand-boule': replayInInsertionOrder,
    gluten: replayPrecedenceFirst(['style', 'topology', 'amount']),
    crust: replayPrecedenceFirst(['style']),
    bacteria: replayBacteriaProjection,
    grinder: replayPrecedenceFirst(['neuralEnabled']),
    proof: replayInInsertionOrder,
    'dutch-oven': replayInInsertionOrder,
    'native-scoring': replayInInsertionOrder,
    knead: replayInInsertionOrder,
    'transient-shaper': replayInInsertionOrder,
    yeast: replayInInsertionOrder,
    'drum-kit': replayInInsertionOrder,
    synth: replayInInsertionOrder,
};

/**
 * Order a device's numeric parameter entries for replay into an audio engine.
 *
 * Projects Bacteria's saved band overrides and crossovers for replay. For
 * other devices, replays any leading precedence keys first in declared precedence order,
 * followed by all other parameters in their original insertion order.
 */
export function orderDeviceParametersForReplay(
    deviceType: string,
    parameterValues: ParameterValues
): Array<[string, number]> {
    const canonicalType = resolveNativeDspDeviceType(deviceType) ?? deviceType.toLowerCase();
    const builtinType = resolveBuiltinDeviceType(canonicalType);
    if (builtinType === null) {
        return replayInInsertionOrder(parameterValues);
    }
    return PATCH_REPLAY_BY_TYPE[builtinType](parameterValues);
}
