/**
 * What each Electron-exposed command's positional arguments are, in order.
 *
 * `window.sourdaw.invoke` takes a positional array — not the named record
 * shape Tauri's `invoke` took — so the bridge seam has to order a caller's
 * named arguments before they cross. The order here *is* the wire contract:
 * under napi-rs a transposed pair of same-typed parameters deserializes
 * without a word and surfaces as a plugin that will not load or a request
 * signed with the wrong key.
 *
 * Parameter names are the addon's own snake_case; the seam derives the
 * caller-facing camelCase key from each. `on_event` stream emitters are
 * excluded — the Electron router appends its own emitter, and the seam routes
 * a channel-carrying call through `stream` instead.
 *
 * Two pins keep this honest: `electron/__tests__/commands.spec.ts` proves this
 * table equal to the one derived from the addon's `#[napi]` signatures, and
 * `src/utils/__tests__/desktopBridge.spec.ts` proves the seam orders arguments
 * by it.
 */
export const SOURDAW_COMMAND_ARGUMENTS: ReadonlyMap<string, readonly string[]> = new Map([
    ['analyze_pitch', ['analysis_id', 'audio_path']],
    ['arm_recording', ['instance_id', 'threshold', 'target_pad', 'max_duration_secs']],
    ['cancel_provider_gateway_request', ['request_id']],
    ['close_midi_input', []],
    ['close_plugin_gui', ['instance_id']],
    ['close_provider_gateway_session', ['session_id']],
    ['close_push_transport', []],
    ['collab_apply_change', ['doc_id', 'change_bytes']],
    ['collab_create_project', ['name', 'sample_rate']],
    ['collab_get_document_state', ['doc_id']],
    ['collab_load_bundle', ['path']],
    ['collab_merge_bundle', ['path']],
    ['collab_save_bundle', ['path']],
    ['commit_pitch_edit', ['request']],
    ['create_crumbs', ['instance_id', 'sample_rate']],
    ['crumbs_all_sound_off', ['instance_id']],
    ['crumbs_note_off', ['instance_id', 'note']],
    ['crumbs_note_on', ['instance_id', 'note', 'velocity']],
    ['denoise_audio', ['request']],
    ['destroy_crumbs', ['instance_id']],
    ['detect_onsets', ['instance_id', 'sample_id', 'algorithm']],
    ['detect_smart_loop_points', ['instance_id', 'sample_id']],
    ['engine_rt_diagnostics', []],
    ['get_crumbs_position', ['instance_id']],
    ['get_default_plugin_paths', []],
    ['get_plugin_parameters', ['instance_id']],
    ['get_plugin_state_bytes', ['instance_id']],
    ['get_waveform_peaks', ['instance_id', 'sample_id', 'level', 'channel']],
    ['is_plugin_gui_supported', ['instance_id']],
    ['list_directory', ['path']],
    ['list_midi_inputs', []],
    ['load_cached_whisper_model', []],
    ['load_plugin', ['plugin_id', 'instance_id']],
    ['load_sample', ['instance_id', 'file_path']],
    ['map_graph_batch', ['prior', 'batch', 'sample_rate', 'session']],
    ['open_midi_input', ['port_index']],
    ['open_plugin_gui', ['instance_id']],
    ['open_provider_gateway_session', ['adapter_id', 'origin', 'credential_source']],
    ['open_push_transport', ['model']],
    ['parse_scl', ['content', 'root_note', 'root_freq']],
    ['process_plugin_audio', ['instance_id', 'audio_bytes']],
    ['provider_gateway_request', ['request_id', 'session_id', 'operation', 'body']],
    ['read_file_bytes', ['path']],
    ['register_timeline_sample', ['sample_id', 'sample_rate', 'channels', 'pcm']],
    ['render_graph_offline', ['batch', 'frames', 'sample_rate']],
    ['scan_plugins', ['paths']],
    ['send_push_midi', ['bytes']],
    ['set_crumbs_mode', ['instance_id', 'mode']],
    ['set_crumbs_param', ['instance_id', 'param', 'value']],
    ['set_plugin_bypass', ['instance_id', 'bypassed']],
    ['set_plugin_parameter', ['instance_id', 'param_id', 'value']],
    ['set_plugin_state_bytes', ['instance_id', 'plugin_state']],
    ['stop_recording', ['instance_id']],
    ['unload_plugin', ['instance_id']],
    ['write_file_bytes', ['path', 'data']],
    ['write_push2_display', ['bytes']],
]);
