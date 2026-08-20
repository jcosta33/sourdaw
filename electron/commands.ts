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
    'disable_link',
    'enable_link',
    'engine_rt_diagnostics',
    'ensure_whisper_ready',
    'get_crumbs_position',
    'get_default_plugin_paths',
    'get_link_status',
    'get_plugin_parameters',
    'get_plugin_state_bytes',
    'get_waveform_peaks',
    'is_plugin_gui_supported',
    'link_start_playing',
    'link_stop_playing',
    'list_directory',
    'list_midi_inputs',
    'load_plugin',
    'load_sample',
    'open_midi_input',
    'open_plugin_gui',
    'open_provider_gateway_session',
    'open_push_transport',
    'parse_scl',
    'process_plugin_audio',
    'provider_gateway_request',
    'read_file_bytes',
    'register_timeline_sample',
    'render_graph_offline',
    'scan_plugins',
    'send_push_midi',
    'set_crumbs_mode',
    'set_crumbs_param',
    'set_link_tempo',
    'set_plugin_bypass',
    'set_plugin_parameter',
    'set_plugin_state_bytes',
    'start_dictation',
    'stop_dictation',
    'stop_recording',
    'unload_plugin',
    'write_file_bytes',
    'write_push2_display',
] as const;

/**
 * Commands with no handler and no preload path.
 *
 * Each was already withheld from the renderer under the Tauri shell, and for
 * a reason that survived the shell change: a bulk plugin-GUI operation belongs
 * to the exit cascade rather than to a page, LAN discovery is not
 * renderer-driven, and the raw audio-file and whisper-model paths are
 * reachable only through the narrower commands that wrap them.
 *
 * The three graph commands (`apply_graph_commands`, `register_timeline_sample`,
 * `render_graph_offline`) are exposed as of D3.b: their production caller is
 * the native `AudioGraphBackend` bridge
 * (`src/modules/AudioEngine/repositories/nativeGraph/`), which serves the
 * offline render path only — the shipping offline renderer stays Web Audio,
 * and live adoption of `apply_graph_commands` is gated on the D3.c cutover
 * (jcosta33/sourdaw#2214).
 */
export const DENIED_COMMANDS = [
    'close_all_plugin_guis',
    'collab_get_nearby_sessions',
    'collab_start_advertising',
    'collab_start_browsing',
    'collab_stop_advertising',
    'collab_stop_browsing',
    'detect_sample_pitch',
    'get_asr_status',
    'hide_all_plugin_guis',
    'load_whisper_model',
    'post_process_audio',
    'read_audio_file',
    'send_plugin_midi',
    'show_all_plugin_guis',
    'update_plugin_transport',
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
