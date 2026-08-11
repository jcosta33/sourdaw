use std::{fs, path::Path};

fn read(path: &Path) -> String {
    fs::read_to_string(path)
        .unwrap_or_else(|error| panic!("failed to read {}: {error}", path.display()))
}

#[test]
fn native_engine_exposes_no_mts_esp_stub_or_false_support_path() {
    let tauri_root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let workspace_root = tauri_root
        .parent()
        .expect("src-tauri must be inside the workspace");
    let engine_root = workspace_root.join("crates/daw-engine");
    let engine_lib = read(&engine_root.join("src/lib.rs"));
    let plugin_commands = read(&tauri_root.join("src/commands/plugins.rs"));
    let tauri_manifest = read(&tauri_root.join("Cargo.toml"));

    assert!(!engine_root.join("src/mts_esp.rs").exists());
    for forbidden in [
        "pub mod mts_esp",
        "MtsEspMaster",
        "register_mts_esp_master",
        "register_default_mts_esp_master",
        "update_mts_esp",
    ] {
        assert!(
            !engine_lib.contains(forbidden),
            "daw-engine still exposes {forbidden}"
        );
    }
    for forbidden in [
        "register_default_mts_esp_master",
        "update_mts_esp",
        "MTS-ESP support",
    ] {
        assert!(
            !plugin_commands.contains(forbidden),
            "Tauri plugin commands still expose {forbidden}"
        );
    }
    assert!(!tauri_manifest.contains("triple_buffer ="));
}
