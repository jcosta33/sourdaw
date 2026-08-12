fn main() {
    let profile = std::env::var("PROFILE").expect("Cargo PROFILE");
    let opt_level = std::env::var("OPT_LEVEL").expect("Cargo OPT_LEVEL");
    println!("cargo:rustc-env=DAW_DSP_CARGO_PROFILE={profile}");
    println!("cargo:rustc-env=DAW_DSP_CARGO_OPT_LEVEL={opt_level}");
    println!("cargo:rerun-if-changed=build.rs");
}
