fn main() {
    let profile = std::env::var("PROFILE").expect("Cargo PROFILE");
    let opt_level = std::env::var("OPT_LEVEL").expect("Cargo OPT_LEVEL");
    let release_lto =
        std::env::var("CARGO_PROFILE_RELEASE_LTO").unwrap_or_else(|_| "true".to_owned());
    let release_codegen_units =
        std::env::var("CARGO_PROFILE_RELEASE_CODEGEN_UNITS").unwrap_or_else(|_| "16".to_owned());
    println!("cargo:rustc-env=DAW_DSP_CARGO_PROFILE={profile}");
    println!("cargo:rustc-env=DAW_DSP_CARGO_OPT_LEVEL={opt_level}");
    println!("cargo:rustc-env=DAW_DSP_CARGO_RELEASE_LTO={release_lto}");
    println!("cargo:rustc-env=DAW_DSP_CARGO_RELEASE_CODEGEN_UNITS={release_codegen_units}");
    println!("cargo:rerun-if-env-changed=CARGO_PROFILE_RELEASE_LTO");
    println!("cargo:rerun-if-env-changed=CARGO_PROFILE_RELEASE_CODEGEN_UNITS");
    println!("cargo:rerun-if-changed=../../Cargo.toml");
    println!("cargo:rerun-if-changed=build.rs");
}
