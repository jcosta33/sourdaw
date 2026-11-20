//! Installing the dylib `cargo test` just built as a `.clap` file and a
//! `.vst3` bundle, shared by every test binary that loads it through the real
//! wrappers.

#![allow(
    dead_code,
    reason = "each test binary compiles this module and uses its own part of it"
)]

use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use daw_plugin_host::vst3_wrapper::format_class_id;
use daw_plugin_host::{ClapWrapper, ProcessMode, Vst3Wrapper};
use sourdaw_harness_fx::VST3_CLASS_ID;
use vst3::Steinberg::TUID;

pub const SAMPLE_RATE: f64 = 48_000.0;

/// The cdylib this crate's build produced, found the way
/// `sourdaw-harness-tone`'s acceptance test finds its own: `deps/` first, the
/// profile directory as the fallback.
fn built_cdylib_path() -> PathBuf {
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

/// A fresh temp directory holding the dylib as a `.clap` file and as a `.vst3`
/// bundle, torn down on drop.
pub struct InstalledPlugin {
    root: PathBuf,
    pub clap_path: PathBuf,
    pub vst3_bundle: PathBuf,
}

impl InstalledPlugin {
    pub fn create(test_name: &str) -> Self {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("the system clock should be after the unix epoch")
            .as_nanos();
        let root = fs::canonicalize(env::temp_dir())
            .expect("the temp directory should resolve")
            .join(format!(
                "sourdaw-harness-fx-{test_name}-{}-{unique}",
                std::process::id()
            ));
        fs::create_dir_all(&root).expect("the temp root should be created");

        let source = built_cdylib_path();
        assert!(source.exists(), "the cdylib must be built: {source:?}");

        let clap_path = root.join("HarnessFx.clap");
        fs::copy(&source, &clap_path).expect("the cdylib should copy into the .clap path");

        let vst3_bundle = root.join("HarnessFx.vst3");
        install_vst3_module(&source, &vst3_bundle);

        Self {
            root,
            clap_path,
            vst3_bundle,
        }
    }

    pub fn clap(&self, plugin_id: &str, mode: ProcessMode) -> Result<ClapWrapper, String> {
        let path = self.clap_path.to_str().expect("the path should be utf8");
        ClapWrapper::new_with_mode(path, plugin_id, SAMPLE_RATE, mode)
    }

    pub fn vst3(&self, mode: ProcessMode) -> Vst3Wrapper {
        self.vst3_class(&VST3_CLASS_ID, mode)
    }

    /// One class of the bundle, loaded and activated in `mode`.
    pub fn vst3_class(&self, class_id: &TUID, mode: ProcessMode) -> Vst3Wrapper {
        Vst3Wrapper::new_with_mode(
            &self.vst3_bundle,
            &format_class_id(class_id),
            SAMPLE_RATE,
            mode,
        )
        .expect("the VST3 class should load and activate")
    }
}

impl Drop for InstalledPlugin {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

/// Place the module where `Vst3Instance::open` looks for it on this platform:
/// a CFBundle executable on macOS, `Contents/<machine>-linux/<name>.so` on
/// Linux, `Contents/<arch>-win/<name>.vst3` on Windows. The VST3 cases run on
/// all three, the platforms that loader supports.
fn install_vst3_module(source: &Path, bundle: &Path) {
    let module = vst3_module_path(bundle);
    fs::create_dir_all(module.parent().expect("the module path has a parent"))
        .expect("the bundle directories should be created");
    fs::copy(source, &module).expect("the cdylib should copy into the bundle");
    if cfg!(target_os = "macos") {
        fs::write(bundle.join("Contents").join("Info.plist"), INFO_PLIST)
            .expect("the bundle's Info.plist should be written");
    }
}

#[cfg(target_os = "macos")]
fn vst3_module_path(bundle: &Path) -> PathBuf {
    daw_plugin_host::vst3_module::macos_executable_path(bundle).unwrap()
}

#[cfg(target_os = "windows")]
fn vst3_module_path(bundle: &Path) -> PathBuf {
    daw_plugin_host::vst3_module::windows_module_paths(bundle, env::consts::ARCH)
        .unwrap()
        .remove(0)
}

#[cfg(all(unix, not(target_os = "macos")))]
fn vst3_module_path(bundle: &Path) -> PathBuf {
    daw_plugin_host::vst3_module::linux_module_path(bundle, env::consts::ARCH)
        .unwrap()
        .expect("the VST3 layout names this architecture")
}

/// The keys CoreFoundation needs to load the bundle's executable.
const INFO_PLIST: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>HarnessFx</string>
    <key>CFBundleIdentifier</key>
    <string>com.sourdaw.harness-fx</string>
    <key>CFBundlePackageType</key>
    <string>BNDL</string>
</dict>
</plist>
"#;
