/**
 * Canonical device-type matchers for the two device families that are voiced by
 * a note/kit scheduler rather than by an audio-node device chain, and the one
 * rule that picks which instrument on a track receives its notes.
 *
 * These live outside `src/modules` because the live scheduler (Transport,
 * Synth), live MIDI input (MIDI) and the offline renderer and audition
 * (AudioEngine) have to agree on them exactly,
 * and the module graph gives them no shared contract barrel: Transport and
 * Arrangement both import `AudioEngine/useCases`, so any AudioEngine file that
 * reached back for one of these predicates would close a dependency cycle.
 *
 * Keeping one copy here is the point. `isNodelessOfflineDeviceType` previously
 * carried its own table of the same ids and had already drifted — it omitted
 * the bare `drum-kit` arm, so a project carrying that type warned on every
 * export while `scheduleTrackClips` was rendering it correctly all along.
 */

/**
 * True for the drum device family, which is rendered by the kit schedulers
 * (`scheduleKitNote` / `scheduleDrumKitNote`) and contributes no chain node.
 *
 * Three arms, all live:
 * - `builtin-drum-kit` — the catalog kit, resolved by `resolveDrumKit`.
 * - `drum-kit` — the bare id factory presets and older projects carry;
 *   `scheduleTrackClips` resolves it through `getDrumKitDefByIndex`.
 * - `builtin-drum-machine*` — the catalog's generated machine variants.
 */
export function isDrumDevice(deviceType: string): boolean {
    return (
        deviceType === 'builtin-drum-kit' || deviceType === 'drum-kit' || deviceType.startsWith('builtin-drum-machine')
    );
}

/**
 * The one drum-kit resolution live playback and offline render both run:
 * the first drum device on the chain selects the kit by its `kit` parameter
 * (the legacy `kitId` when absent, index 0 when neither is set), and `lookup`
 * maps that index to the caller's kit shape. Null when the chain has no drum
 * device or `lookup` knows no kit at that index.
 *
 * Callers differ only in `lookup` — the dedicated drum-voice definitions or
 * the factory kit table — so the device test and the index rule cannot drift
 * between the live scheduler and an export.
 */
export function resolveDrumKitBy<Kit>(
    devices: readonly { type: string; parameterValues: Record<string, number> }[],
    lookup: (kitIndex: number) => Kit | null
): Kit | null {
    const kitDevice = devices.find((device) => isDrumDevice(device.type));
    if (!kitDevice) {
        return null;
    }
    return lookup(kitDevice.parameterValues.kit ?? kitDevice.parameterValues.kitId ?? 0);
}

/**
 * True for the built-in synthesizer family, which is voiced directly by
 * `scheduleNoteOffline` / `scheduleNote` from `getSynthParamsFromDevices` and
 * contributes no chain node. The prefix arm covers the catalog's generated
 * variants (`builtin-synth-strings`, …), which carry parameters on the same
 * device but are still played by the note scheduler.
 */
export function isBuiltinSynthDevice(deviceType: string): boolean {
    return deviceType === 'synth' || deviceType.startsWith('builtin-synth');
}

/**
 * The family a note-accepting instrument belongs to. Each route keeps its own
 * delivery per family; only the choice of device is shared.
 *
 * - `drum` — the drum family (`isDrumDevice`), voiced by the kit schedulers.
 * - `toaster` — the Toaster drum machine, addressed by pad.
 * - `worklet-synth` — Fermenter, Grand Boule, Levain and Crumbs, voiced through
 *   their worklet note controls.
 * - `faust` — a Faust module registered as an instrument.
 * - `builtin-synth` — the built-in synthesizer family (`isBuiltinSynthDevice`).
 */
export type NoteReceivingInstrumentKind = 'drum' | 'toaster' | 'worklet-synth' | 'faust' | 'builtin-synth';

export type NoteReceivingInstrument<TDevice> = Readonly<{
    device: TDevice;
    kind: NoteReceivingInstrumentKind;
}>;

const WORKLET_SYNTH_DEVICE_TYPES: ReadonlySet<string> = new Set([
    'fermenter',
    'grand-boule',
    'levain',
    'builtin-crumbs',
]);

/**
 * The note-accepting family of one device type, or null for a device that
 * takes no notes (an effect, a utility, a MIDI transform such as Yeast).
 *
 * Whether a Faust module is an instrument is a fact of the Faust registry, not
 * of its id (every Faust module, effect or instrument, carries the `faust-`
 * prefix), so the caller supplies that question.
 */
export function classifyNoteReceivingDevice(
    deviceType: string,
    isFaustInstrument: (deviceType: string) => boolean
): NoteReceivingInstrumentKind | null {
    if (isDrumDevice(deviceType)) {
        return 'drum';
    }
    if (deviceType === 'toaster') {
        return 'toaster';
    }
    if (WORKLET_SYNTH_DEVICE_TYPES.has(deviceType)) {
        return 'worklet-synth';
    }
    if (isBuiltinSynthDevice(deviceType)) {
        return 'builtin-synth';
    }
    return isFaustInstrument(deviceType) ? 'faust' : null;
}

/**
 * The instrument a track's notes reach: the first note-accepting instrument in
 * device-chain order, as MIDI flows down a DAW chain to its first instrument and
 * every device after it receives that instrument's audio. Null when the chain
 * holds no instrument. Sequenced playback, the offline render (export, stems,
 * bounce, freeze), live MIDI input and audition all choose through this one
 * function, so no route can voice a different instrument from another.
 *
 * The built-in synth is the one exception to chain order. Every route already
 * voices a track with no other instrument on the built-in synth, and a new MIDI
 * track starts with one at the head of its chain, so an instrument added after
 * it appends behind it. Letting that default device take the notes would replace
 * the instrument the musician added with the default voice. It therefore
 * receives notes only when the chain holds no other instrument.
 */
export function resolveNoteReceivingInstrument<TDevice extends { type: string }>(
    devices: readonly TDevice[],
    isFaustInstrument: (deviceType: string) => boolean
): NoteReceivingInstrument<TDevice> | null {
    let builtinSynth: NoteReceivingInstrument<TDevice> | null = null;
    for (const device of devices) {
        const kind = classifyNoteReceivingDevice(device.type, isFaustInstrument);
        if (kind === null) {
            continue;
        }
        if (kind !== 'builtin-synth') {
            return { device, kind };
        }
        builtinSynth ??= { device, kind };
    }
    return builtinSynth;
}
