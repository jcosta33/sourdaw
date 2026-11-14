use std::path::PathBuf;

fn main() {
    assert!(
        std::env::var_os("WHISPER_DONT_GENERATE_BINDINGS").is_none(),
        "ABI proof requires generated bindings"
    );
    let manifest =
        PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").expect("fixture directory"));
    let sys = manifest.join("../../whisper-rs-sys-0.15.0");
    let source = sys.join("whisper.cpp");
    let out = PathBuf::from(std::env::var_os("OUT_DIR").expect("build output"));
    println!("cargo:rerun-if-changed={}", sys.join("wrapper.h").display());
    println!("cargo:rerun-if-changed=layout.c");
    let bindings = bindgen::Builder::default()
        .rust_edition(bindgen::RustEdition::Edition2021)
        .rust_target(bindgen::RustTarget::stable(88, 0).expect("supported Rust target"))
        .header(sys.join("wrapper.h").to_string_lossy())
        .clang_arg(format!("-I{}", source.display()))
        .clang_arg(format!("-I{}", source.join("include").display()))
        .clang_arg(format!("-I{}", source.join("ggml/include").display()))
        .allowlist_type("whisper_.*")
        .parse_callbacks(Box::new(bindgen::CargoCallbacks::new()))
        .generate()
        .expect("generate actual bundled whisper header bindings");
    bindings
        .write_to_file(out.join("bindings.rs"))
        .expect("write newly generated bindings");
    cc::Build::new()
        .file("layout.c")
        .include(source.join("include"))
        .include(source.join("ggml/include"))
        .std("c11")
        .compile("sourdaw_header_layout");
}
