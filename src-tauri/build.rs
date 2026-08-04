fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "read_audio_file",
            "write_audio_file",
            "list_directory",
        ]),
    ))
    .expect("failed to run tauri build");
}
