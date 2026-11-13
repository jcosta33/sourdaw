use std::path::PathBuf;
fn main() {
    let target = std::env::var("CARGO_CFG_TARGET_OS").expect("target OS");
    assert!(
        target == "macos" || target == "linux",
        "loader teardown fixture requires Mach-O or ELF"
    );
    let out = PathBuf::from(std::env::var_os("OUT_DIR").expect("output directory"));
    for (name, accept) in [("accepted", "1"), ("refused", "0")] {
        let library = out.join(format!("{name}.clap"));
        let mut command = cc::Build::new().get_compiler().to_command();
        command.arg(if target == "macos" {
            "-dynamiclib"
        } else {
            "-shared"
        });
        command
            .args([
                "-fPIC",
                "-std=c11",
                &format!("-DINIT_ACCEPT={accept}"),
                "entry.c",
                "-o",
            ])
            .arg(&library);
        assert!(
            command.status().expect("compile fixture library").success(),
            "fixture library compilation failed"
        );
        println!(
            "cargo:rustc-env=FIXTURE_{}={}",
            name.to_uppercase(),
            library.display()
        );
    }
    println!("cargo:rerun-if-changed=entry.c");
}
