use std::{fs, path::Path};

fn read(path: &Path) -> String {
    fs::read_to_string(path)
        .unwrap_or_else(|error| panic!("failed to read {}: {error}", path.display()))
}

fn collect_production_sources(path: &Path, sources: &mut Vec<std::path::PathBuf>) {
    for entry in fs::read_dir(path)
        .unwrap_or_else(|error| panic!("failed to read {}: {error}", path.display()))
    {
        let entry = entry.expect("production source entry must be readable");
        let entry_path = entry.path();
        if entry_path.is_dir() {
            if matches!(
                entry_path.file_name().and_then(|name| name.to_str()),
                Some("tests" | "__tests__")
            ) {
                continue;
            }
            collect_production_sources(&entry_path, sources);
            continue;
        }
        if matches!(
            entry_path
                .extension()
                .and_then(|extension| extension.to_str()),
            Some("rs" | "ts" | "tsx" | "toml")
        ) {
            sources.push(entry_path);
        }
    }
}

#[test]
fn native_engine_exposes_no_mts_esp_stub_or_false_support_path() {
    let tauri_root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let workspace_root = tauri_root
        .parent()
        .expect("src-tauri must be inside the workspace");
    let engine_root = workspace_root.join("crates/daw-engine");
    let mut production_sources = Vec::new();
    for root in [
        workspace_root.join("crates"),
        tauri_root.join("src"),
        workspace_root.join("src"),
        workspace_root.join("server"),
    ] {
        collect_production_sources(&root, &mut production_sources);
    }
    production_sources.push(workspace_root.join("Cargo.toml"));
    production_sources.push(tauri_root.join("Cargo.toml"));

    assert!(!engine_root.join("src/mts_esp.rs").exists());
    for source_path in production_sources {
        let source = read(&source_path);
        for forbidden in ["MTS-ESP", "mts_esp", "MtsEsp", "register_mts", "update_mts"] {
            assert!(
                !source.contains(forbidden),
                "{} still contains {forbidden}",
                source_path.display()
            );
        }
    }
    assert!(!read(&tauri_root.join("Cargo.toml")).contains("triple_buffer ="));

    let allowed_guidance = read(&tauri_root.join("AGENTS.md"));
    assert!(allowed_guidance.contains("MTS-ESP host support is absent"));
}
