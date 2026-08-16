use std::{collections::BTreeSet, fs, path::Path};

use serde_json::Value;

fn read(path: &Path) -> String {
    fs::read_to_string(path)
        .unwrap_or_else(|error| panic!("failed to read {}: {error}", path.display()))
}

/// The command set registered with the webview, read from the single
/// `generate_handler!` block.
///
/// Scoped to that block rather than scanned over the whole file: `commands::`
/// also opens lines elsewhere in `lib.rs` — the exit handler calls command
/// bodies directly — and a whole-file scan reads a call expression as a
/// registration, inventing a name no manifest can ever match.
fn handler_command_names(source: &str) -> BTreeSet<String> {
    let handler_block = source
        .split("tauri::generate_handler![")
        .nth(1)
        .and_then(|tail| tail.split("])").next())
        .expect("lib.rs must register commands in one explicit invoke handler");

    handler_block
        .lines()
        .map(str::trim)
        .filter(|line| line.starts_with("commands::"))
        .filter_map(|line| {
            line.rsplit("::")
                .next()
                .map(|name| name.trim_end_matches(',').trim_matches('"').to_owned())
        })
        .collect()
}

fn manifest_command_names(source: &str) -> BTreeSet<String> {
    let command_block = source
        .split(".commands(&[")
        .nth(1)
        .and_then(|tail| tail.split("])").next())
        .expect("build manifest must contain an explicit command list");

    command_block
        .lines()
        .map(str::trim)
        .filter_map(|line| line.strip_prefix('"'))
        .filter_map(|line| line.split('"').next())
        .map(str::to_owned)
        .collect()
}

fn permission_command_names(source: &str) -> BTreeSet<String> {
    let command_block = source
        .split("commands.allow = [")
        .nth(1)
        .and_then(|tail| tail.split(']').next())
        .expect("permission must contain an explicit command allowlist");

    command_block
        .lines()
        .map(str::trim)
        .filter_map(|line| line.strip_prefix('"'))
        .filter_map(|line| line.split('"').next())
        .map(str::to_owned)
        .collect()
}

#[test]
fn provider_gateway_webview_boundary() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let configuration: Value = serde_json::from_str(&read(&root.join("tauri.conf.json")))
        .expect("Tauri configuration must be valid JSON");
    let security = &configuration["app"]["security"];
    let production_csp = security["csp"]
        .as_str()
        .expect("production CSP must be configured");
    let development_csp = security["devCsp"]
        .as_str()
        .expect("development CSP must be separate");

    assert!(!production_csp.contains("'unsafe-eval'"));
    assert!(!production_csp.contains("script-src 'self' 'unsafe-inline'"));
    assert!(!production_csp.contains("ws://localhost"));
    assert!(!production_csp.contains(" connect-src 'self' ipc: http://ipc.localhost http: "));
    assert!(production_csp.contains("script-src 'self' 'wasm-unsafe-eval'"));
    assert!(production_csp.contains(
        "connect-src 'self' ipc: http://ipc.localhost http://localhost:* http://127.0.0.1:* http://[::1]:* https:"
    ));
    assert!(production_csp.contains("worker-src 'self';"));
    assert!(!production_csp.contains("worker-src 'self' blob:"));
    assert!(development_csp.contains("http://localhost:*"));
    assert!(development_csp.contains("ws://localhost:*"));

    let handler_commands = handler_command_names(&read(&root.join("src/lib.rs")));
    let manifest_commands = manifest_command_names(&read(&root.join("build.rs")));
    assert_eq!(manifest_commands, handler_commands);

    let permission_commands =
        permission_command_names(&read(&root.join("permissions/sourdaw-commands.toml")));
    let denied_commands = BTreeSet::from([
        "close_all_plugin_guis".to_owned(),
        "collab_get_nearby_sessions".to_owned(),
        "collab_start_advertising".to_owned(),
        "collab_start_browsing".to_owned(),
        "collab_stop_advertising".to_owned(),
        "collab_stop_browsing".to_owned(),
        "detect_sample_pitch".to_owned(),
        "get_asr_status".to_owned(),
        "hide_all_plugin_guis".to_owned(),
        "load_whisper_model".to_owned(),
        "post_process_audio".to_owned(),
        "read_audio_file".to_owned(),
        "send_plugin_midi".to_owned(),
        "show_all_plugin_guis".to_owned(),
        "start_audio_gen_sidecar".to_owned(),
        "start_native_engine".to_owned(),
        "stop_audio_gen_sidecar".to_owned(),
        "update_plugin_transport".to_owned(),
        "write_audio_file".to_owned(),
    ]);
    assert_eq!(
        handler_commands
            .difference(&permission_commands)
            .cloned()
            .collect::<BTreeSet<_>>(),
        denied_commands
    );

    let capability: Value = serde_json::from_str(&read(&root.join("capabilities/default.json")))
        .expect("main capability must be valid JSON");
    assert_eq!(capability["windows"], serde_json::json!(["main"]));
    assert!(capability.get("remote").is_none());
    let permissions = capability["permissions"]
        .as_array()
        .expect("main capability permissions must be an array");
    assert!(permissions
        .iter()
        .any(|permission| permission == "allow-sourdaw-commands"));
    assert!(!permissions
        .iter()
        .any(|permission| permission == "core:event:allow-emit"));
}
