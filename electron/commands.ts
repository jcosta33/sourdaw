/**
 * The command surface the shell exposes to the renderer (REQ-004).
 *
 * Two lists, and the boundary between them is the whole security model of the
 * IPC layer: a command in `EXPOSED_COMMANDS` gets an `ipcMain.handle`
 * registration and a preload path; a command in `DENIED_COMMANDS` gets neither,
 * so the renderer cannot name it at all.
 *
 * ## Where these names come from
 *
 * - **Registered** — every renderer-invokable `#[napi]` item in
 *   `crates/sourdaw-native/src/addon/mod.rs`, minus the shell-plumbing methods
 *   the spec pins by name. That is the set of command bodies the product
 *   ships.
 * - **Exposed** — the product's decision about what a renderer may invoke.
 *   This list is that decision's record: exposing a command means reviewing
 *   its body as renderer-reachable attack surface, and every entry must have a
 *   production caller in `src/`.
 * - **Denied** — registered minus exposed. They keep their bodies and stay
 *   reachable in-process (the exit cascade closes plugin editors through one
 *   of them), but no renderer may ask for them.
 *
 * `commands.spec.ts` re-derives the registered set from the Rust source at
 * test time and fails unless these two lists partition it exactly, so adding
 * a Rust command without deciding which side of this boundary it falls on
 * cannot pass silently. A list pinned by a hand-copied count instead would
 * pass while blind to exactly that.
 */

/**
 * Commands the renderer may invoke.
 *
 * Sorted, because the order carries no meaning and a sorted list makes an
 * addition a one-line diff at the right place rather than an append anywhere.
 */
export const EXPOSED_COMMANDS = [
    'analyze_pitch',
    'apply_graph_commands',
    'arm_recording',
    'cancel_provider_gateway_request',
    'close_midi_input',
    'close_plugin_gui',
    'close_provider_gateway_session',
    'close_push_transport',
    'collab_apply_change',
    'collab_create_project',
    'collab_get_document_state',
    'collab_load_bundle',
    'collab_merge_bundle',
    'collab_save_bundle',
    'commit_pitch_edit',
    'create_crumbs',
    'crumbs_all_sound_off',
    'crumbs_note_off',
    'crumbs_note_on',
    'denoise_audio',
    'destroy_crumbs',
    'detect_onsets',
    'detect_smart_loop_points',
    'engine_rt_diagnostics',
    'engine_transport_position',
    'engine_transport_set_maps',
    'get_crumbs_position',
    'get_default_plugin_paths',
    'get_plugin_parameters',
    'get_plugin_state_bytes',
    'get_waveform_peaks',
    'is_scan_path_authorized',
    'list_directory',
    'list_midi_inputs',
    'load_cached_whisper_model',
    'load_plugin',
    'load_sample',
    'map_graph_batch',
    'open_midi_input',
    'open_plugin_gui',
    'open_provider_gateway_session',
    'open_push_transport',
    'parse_scl',
    'provider_gateway_request',
    'read_file_bytes',
    'register_timeline_sample',
    'render_graph_offline',
    'scan_plugins',
    'send_push_midi',
    'set_crumbs_mode',
    'set_crumbs_param',
    'set_plugin_bypass',
    'set_plugin_parameter',
    'set_plugin_state_bytes',
    'stop_recording',
    'unload_plugin',
    'write_file_bytes',
    'write_push2_display',
] as const;

/**
 * Commands with no handler and no preload path.
 *
 * Every command here except the Link group was already withheld from the
 * renderer under the Tauri shell, and for a reason that survived the shell
 * change: a bulk plugin-GUI operation belongs to the exit cascade rather than
 * to a page, LAN discovery is not renderer-driven, and the raw audio-file and
 * whisper-model paths are reachable only through the narrower commands that
 * wrap them.
 *
 * The Link transport commands (`enable_link`, `disable_link`,
 * `set_link_tempo`, `get_link_status`, `link_start_playing`,
 * `link_stop_playing`) are that exception, and are denied for a different
 * reason: Tauri's `allow-sourdaw-commands` capability granted all of them to
 * the main window (`src-tauri/permissions/sourdaw-commands.toml`), and they
 * carried into `EXPOSED_COMMANDS` unchanged at the Tauri-to-Electron cutover.
 * The callers that grant was written for were already gone by then. The
 * transport UI's Link toggle went in jcosta33/sourdaw#1640, and `4497e0047`
 * (jcosta33/sourdaw#2039) deleted the `linkBridge` repositories, the `link`
 * use cases and `linkStatusStore` as orphaned — hours before `2b67adcd7`
 * created this shell's surface, which is why the grants arrived callerless.
 * Nothing in `src/` has invoked them since.
 *
 * The reason that outlasts any of that: Link is a declared-unsupported
 * capability surface. `crates/sourdaw-native/src/commands/link.rs` answers
 * every one of these with `supported: false` and a "not implemented in this
 * build" message, and `crates/sourdaw-native/AGENTS.md` pins that no native
 * Link library is linked. Exposing them would widen the renderer's reach onto
 * stubs, so they stay denied until Link is implemented and a caller exists.
 *
 * The offline graph commands (`map_graph_batch`, `register_timeline_sample`,
 * `render_graph_offline`) are exposed as of the D3.c.2 cutover
 * (jcosta33/sourdaw#2225): desktop offline export selects the native engine in
 * `selectOfflineRenderEngine`, which reaches them through
 * `src/modules/AudioEngine/repositories/nativeGraph/nativeGraphTransport.ts`.
 * `apply_graph_commands` joined them at the first live-cutover slice
 * (jcosta33/sourdaw#3066), with the production caller the exposure law
 * requires: playback start applies the session's topology through
 * `startNativeLiveGraphSession`, and that first batch is also what boots the
 * native engine. It is the one exposed command that can *start* an audio
 * stream, which is why `pluginCommandAdmission` closes it with the plugin
 * runtime surface at quit.
 *
 * `grant_path` is denied for the reason it exists (jcosta33/sourdaw#3313). It
 * is the only way to widen what the native file commands will touch, so a
 * renderer able to name it could grant itself the user directories those
 * commands used to admit outright. The main process calls it directly on the
 * addon, for the path a native dialog is about to return, which is what makes
 * "the user picked this" the only way a path becomes reachable.
 *
 * `send_plugin_midi` is denied for a reason of its own: it is block-immediate
 * and carries no timing contract. It hands a plugin one note at the head of
 * whichever block it is next given, because a note struck on a keyboard has no
 * timeline position to stamp it against — which makes it the wrong shape for
 * arranged material entirely. Notes that do have a position travel as
 * `schedule-midi` and `clear-midi` commands inside `apply_graph_commands`,
 * where the pair that rewrites a bar shares one batch and so one visibility on
 * the audio thread. A renderer able to name this command could only play a
 * note late and out of order beside them.
 *
 * `is_plugin_gui_supported` moved here from the exposed list when its
 * renderer repository was retired (#2307): the inspector reads editor
 * capability through `resolvePluginEditorCapability`, so no `src/` caller
 * invokes the command. Exposing a command requires a production caller, so
 * it stays denied until one exists. `get_plugin_parameters` was retired in
 * the same change and restored: `refreshExternalPluginParameters` re-reads a
 * loaded instance's parameters through it whenever the automation menu or
 * panel opens, so its caller never went away.
 */
export const DENIED_COMMANDS = [
    'cancel_dictation',
    'close_all_plugin_guis',
    'collab_get_nearby_sessions',
    'collab_start_advertising',
    'collab_start_browsing',
    'collab_stop_advertising',
    'collab_stop_browsing',
    'detect_sample_pitch',
    'disable_link',
    'enable_link',
    'get_asr_status',
    'get_link_status',
    'grant_path',
    'hide_all_plugin_guis',
    'is_plugin_gui_supported',
    'link_start_playing',
    'link_stop_playing',
    'load_whisper_model',
    'read_audio_file',
    'send_plugin_midi',
    'set_link_tempo',
    'show_all_plugin_guis',
    'start_dictation',
    'stop_dictation',
    'write_audio_file',
] as const;

export type ExposedCommand = (typeof EXPOSED_COMMANDS)[number];

const EXPOSED_COMMAND_SET: ReadonlySet<string> = new Set<string>(EXPOSED_COMMANDS);

/** Whether the renderer is allowed to name this command. */
export const isExposedCommand = (command: string): command is ExposedCommand => EXPOSED_COMMAND_SET.has(command);

/**
 * The `ipcMain` channel one command is handled on.
 *
 * One channel per command rather than one shared channel carrying the name,
 * so "registers a handler for exactly the exposed commands" is a property of
 * the channel table and not of a branch inside a single handler. A denied
 * command has no channel to reach.
 */
export const commandChannel = (command: string): string => `sourdaw:invoke:${command}`;

/**
 * The addon method that implements a command.
 *
 * `#[napi]` publishes Rust `snake_case` items under `camelCase` JS names, so the
 * wire name and the method name differ by convention alone. Translating here
 * keeps the wire in the product's own vocabulary — the renderer and the
 * fixtures all say `get_plugin_state_bytes` — while calling the addon by the
 * name it actually exports.
 */
export const addonMethodName = (command: string): string =>
    command.replaceAll(/_([a-z0-9])/gu, (_match, character: string) => character.toUpperCase());
