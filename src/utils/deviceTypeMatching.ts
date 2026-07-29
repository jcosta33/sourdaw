/**
 * Canonical device-type matchers for the two device families that are voiced by
 * a note/kit scheduler rather than by an audio-node device chain.
 *
 * These live outside `src/modules` because both the live scheduler (Transport,
 * Synth) and the offline renderer (AudioEngine) have to agree on them exactly,
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
 * True for the built-in synthesizer family, which is voiced directly by
 * `scheduleNoteOffline` / `scheduleNote` from `getSynthParamsFromDevices` and
 * contributes no chain node. The prefix arm covers the catalog's generated
 * variants (`builtin-synth-strings`, …), which carry parameters on the same
 * device but are still played by the note scheduler.
 */
export function isBuiltinSynthDevice(deviceType: string): boolean {
    return deviceType === 'synth' || deviceType.startsWith('builtin-synth');
}
