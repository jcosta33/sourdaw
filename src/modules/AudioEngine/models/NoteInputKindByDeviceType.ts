import { type BuiltinDeviceType, resolveBuiltinDeviceType } from '#/utils/builtinDeviceTypes';

/**
 * The family a note-accepting instrument belongs to. Each route keeps its own
 * delivery per family; only the choice of device is shared.
 *
 * - `drum` — the drum family (`isDrumDevice`), voiced by the kit schedulers
 *   (`scheduleKitNote` / `scheduleDrumKitNote`) and contributing no chain node.
 * - `toaster` — the Toaster drum machine, addressed by pad.
 * - `worklet-synth` — Fermenter, Grand Boule, Levain and Crumbs, voiced through
 *   their worklet note controls.
 * - `faust` — a Faust module registered as an instrument.
 * - `builtin-synth` — the built-in synthesizer family (`isBuiltinSynthDevice`),
 *   voiced directly by `scheduleNoteOffline` / `scheduleNote` from
 *   `getSynthParamsFromDevices` and contributing no chain node.
 */
export type NoteReceivingInstrumentKind = 'drum' | 'toaster' | 'worklet-synth' | 'faust' | 'builtin-synth';

/**
 * The note-input family of every built-in device type, or null for a device
 * that takes no notes (an effect, a utility, a MIDI transform such as Yeast).
 * Exhaustive over the vocabulary, so a new built-in id fails to compile here
 * until someone decides whether it receives notes (ADR 0063).
 *
 * The drum family keeps three live arms: `builtin-drum-kit` (the catalog kit),
 * `drum-kit` (the bare id factory presets and older projects carry) and the
 * `builtin-drum-machine-*` variants. The built-in synth keeps the legacy `synth`
 * id beside `builtin-synth` and its variants. No Faust row: whether a Faust module
 * is an instrument is a fact of the Faust registry, not of its id.
 */
const NOTE_INPUT_KIND_BY_DEVICE_TYPE: { readonly [Type in BuiltinDeviceType]: NoteReceivingInstrumentKind | null } = {
    'builtin-eq': null,
    'builtin-compressor': null,
    'builtin-reverb': null,
    'builtin-delay': null,
    'builtin-gain': null,
    'builtin-sidechain-compressor': null,
    'builtin-chorus': null,
    'builtin-phaser': null,
    'builtin-distortion': null,
    'builtin-limiter': null,
    'builtin-flanger': null,
    'builtin-tremolo': null,
    'builtin-bitcrusher': null,
    'builtin-filter': null,
    'builtin-autopan': null,
    'builtin-convolution-reverb': null,
    'builtin-stereo-widener': null,
    'builtin-deesser': null,
    'builtin-lufs-meter': null,
    'builtin-synth': 'builtin-synth',
    'builtin-synth-mellotron': 'builtin-synth',
    'builtin-synth-strings': 'builtin-synth',
    'builtin-synth-808bass': 'builtin-synth',
    'builtin-synth-brass': 'builtin-synth',
    'builtin-drum-kit': 'drum',
    'builtin-drum-machine-808': 'drum',
    'builtin-drum-machine-analog': 'drum',
    'builtin-drum-machine-electronic': 'drum',
    'builtin-drum-machine-acoustic': 'drum',
    fermenter: 'worklet-synth',
    toaster: 'toaster',
    levain: 'worklet-synth',
    'builtin-crumbs': 'worklet-synth',
    'grand-boule': 'worklet-synth',
    gluten: null,
    crust: null,
    bacteria: null,
    grinder: null,
    proof: null,
    'dutch-oven': null,
    'native-scoring': null,
    knead: null,
    'transient-shaper': null,
    yeast: null,
    'drum-kit': 'drum',
    synth: 'builtin-synth',
};

/**
 * The note-accepting family of one device type, or null for a device that
 * takes no notes (an effect, a utility, a MIDI transform such as Yeast).
 *
 * Whether a Faust module is an instrument is a fact of the Faust registry, not
 * of its id (every Faust module, effect or instrument, carries the `faust-`
 * prefix), so the caller supplies that question. It is asked only of a type
 * outside the built-in vocabulary, since every registered Faust id is.
 */
export function classifyNoteReceivingDevice(
    deviceType: string,
    isFaustInstrument: (deviceType: string) => boolean
): NoteReceivingInstrumentKind | null {
    const builtinType = resolveBuiltinDeviceType(deviceType);
    if (builtinType !== null) {
        return NOTE_INPUT_KIND_BY_DEVICE_TYPE[builtinType];
    }
    return isFaustInstrument(deviceType) ? 'faust' : null;
}

function noteInputKindOfBuiltin(deviceType: string): NoteReceivingInstrumentKind | null {
    const builtinType = resolveBuiltinDeviceType(deviceType);
    return builtinType === null ? null : NOTE_INPUT_KIND_BY_DEVICE_TYPE[builtinType];
}

/**
 * True for the drum device family, which is rendered by the kit schedulers
 * (`scheduleKitNote` / `scheduleDrumKitNote`) and contributes no chain node.
 */
export function isDrumDevice(deviceType: string): boolean {
    return noteInputKindOfBuiltin(deviceType) === 'drum';
}

/** True for the Toaster drum machine, which takes notes by pad rather than through a kit scheduler. */
export function isToasterDevice(deviceType: string): boolean {
    return noteInputKindOfBuiltin(deviceType) === 'toaster';
}

/**
 * True for the built-in synthesizer family, which is voiced directly by
 * `scheduleNoteOffline` / `scheduleNote` from `getSynthParamsFromDevices` and
 * contributes no chain node. Its generated variants (`builtin-synth-strings`, …)
 * carry parameters on the same device but are still played by the note scheduler.
 */
export function isBuiltinSynthDevice(deviceType: string): boolean {
    return noteInputKindOfBuiltin(deviceType) === 'builtin-synth';
}
