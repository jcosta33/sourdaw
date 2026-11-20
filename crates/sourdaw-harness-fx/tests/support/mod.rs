//! What every integration test here needs to load the fixture: the cdylib
//! `cargo test` just built.

use std::env;
use std::path::PathBuf;

/// The cdylib this crate's build produced, found the way
/// `sourdaw-harness-tone`'s acceptance test finds its own: `deps/` first, the
/// profile directory as the fallback.
pub fn built_cdylib_path() -> PathBuf {
    let test_binary = env::current_exe().expect("the test binary path should resolve");
    let deps_dir = test_binary
        .parent()
        .expect("the test binary should live in a deps directory");
    let in_deps = deps_dir.join(cdylib_file_name());
    if in_deps.exists() {
        return in_deps;
    }
    deps_dir
        .parent()
        .expect("the deps directory should live in a profile directory")
        .join(cdylib_file_name())
}

fn cdylib_file_name() -> &'static str {
    if cfg!(target_os = "macos") {
        "libsourdaw_harness_fx.dylib"
    } else if cfg!(target_os = "windows") {
        "sourdaw_harness_fx.dll"
    } else {
        "libsourdaw_harness_fx.so"
    }
}
