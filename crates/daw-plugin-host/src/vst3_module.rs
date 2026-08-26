//! Opening a `.vst3` bundle and getting its factory, per platform.
//!
//! A `.vst3` is a *folder bundle* on every platform Sourdaw ships on. The bare
//! Windows DLL form has been deprecated since VST 3.6.10, and this module does
//! not probe for it: recognising it would mean claiming support for a layout the
//! format itself retired, and no such file can reach the walk anyway — a bare
//! `.dll` is not recognised as a plugin at all (see `scanner::detect_format`).
//!
//! The three platforms disagree about everything except `GetPluginFactory`:
//!
//! * macOS keeps a real CFBundle and requires `bundleEntry(CFBundleRef)`, which
//!   takes the bundle handle itself. `libloading` hands back no such handle and
//!   a raw `dlopen` leaves nothing to pass, so this platform goes through
//!   CoreFoundation and no other.
//! * Windows keeps `Contents/<arch>/<name>.vst3` and `InitDll`/`ExitDll` are
//!   optional.
//! * Linux keeps `Contents/<machine>-linux/<name>.so` and
//!   `ModuleEntry(void*)`/`ModuleExit` are required.
//!
//! Every path rule above is a pure function taking the architecture it is
//! deciding for, so all of them are exercised on whichever platform the tests
//! happen to run on. Only the loading itself is `cfg`-gated.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use vst3::Steinberg::{IPluginFactory, PFactoryInfo, PFactoryInfo_::FactoryFlags_};
use vst3::{ComPtr, Steinberg::IPluginFactoryTrait};

/// The universal entry point: every VST3 module on every platform exports it.
const GET_PLUGIN_FACTORY: &[u8] = b"GetPluginFactory\0";

// ── Path rules ──────────────────────────────────────────────────────────

/// The bundle's own name without the `.vst3` suffix, which is also the name of
/// the executable inside it. A bundle whose name is not UTF-8 is refused rather
/// than lossily decoded: the probe would then look for a file that is not the
/// one on disk.
fn bundle_stem(bundle: &Path) -> Result<&str, String> {
    bundle
        .file_stem()
        .and_then(|stem| stem.to_str())
        .ok_or_else(|| format!("VST3 bundle has no usable name: {}", bundle.display()))
}

/// Where a bundle may keep its `moduleinfo.json`, newest location first.
///
/// Both are probed because the file moved: VST 3.7.5 put it directly under
/// `Contents`, and 3.7.8 moved it into `Contents/Resources`. A host that reads
/// only the current location silently falls back to loading the binary for
/// every plugin built against the three versions in between.
pub fn module_info_paths(bundle: &Path) -> [PathBuf; 2] {
    [
        bundle
            .join("Contents")
            .join("Resources")
            .join("moduleinfo.json"),
        bundle.join("Contents").join("moduleinfo.json"),
    ]
}

/// The architecture directories a Windows host probes, in preference order.
///
/// `arm64x-win` comes first on ARM because it is the form Steinberg recommends
/// vendors ship, and a host that probes only `arm64-win` finds nothing in a
/// bundle that took that advice. `arm64ec-win` is deliberately absent: an
/// ARM64EC module exists to be loaded into an x64-emulated process, so a native
/// ARM64 host loading one would be running the wrong image.
pub fn windows_architecture_directories(target_arch: &str) -> &'static [&'static str] {
    match target_arch {
        "aarch64" => &["arm64x-win", "arm64-win"],
        "x86_64" => &["x86_64-win"],
        "x86" => &["x86-win"],
        _ => &[],
    }
}

/// Every `Contents/<arch>/<name>.vst3` a Windows host would try, in order.
pub fn windows_module_paths(bundle: &Path, target_arch: &str) -> Result<Vec<PathBuf>, String> {
    let stem = bundle_stem(bundle)?;
    let module_file = format!("{stem}.vst3");
    Ok(windows_architecture_directories(target_arch)
        .iter()
        .map(|architecture| {
            bundle
                .join("Contents")
                .join(architecture)
                .join(&module_file)
        })
        .collect())
}

/// The `uname -m` spelling a Linux bundle names its architecture directory
/// with, or `None` for an architecture the VST3 layout has no name for.
///
/// Rust's own architecture names and `uname -m`'s agree on the two that matter
/// and disagree on 32-bit ARM, which is exactly the case a "just use ARCH"
/// shortcut gets wrong.
pub fn linux_machine_directory(target_arch: &str) -> Option<&'static str> {
    match target_arch {
        "x86_64" => Some("x86_64"),
        "aarch64" => Some("aarch64"),
        "x86" => Some("i386"),
        "arm" => Some("armv7l"),
        _ => None,
    }
}

/// `Contents/<machine>-linux/<name>.so`, or `None` on an architecture the
/// layout cannot name.
pub fn linux_module_path(bundle: &Path, target_arch: &str) -> Result<Option<PathBuf>, String> {
    let stem = bundle_stem(bundle)?;
    Ok(linux_machine_directory(target_arch).map(|machine| {
        bundle
            .join("Contents")
            .join(format!("{machine}-linux"))
            .join(format!("{stem}.so"))
    }))
}

/// `Contents/MacOS/<name>` — the bundle's executable.
///
/// macOS loading goes through `CFBundleCreate` rather than this path, because
/// `bundleEntry` needs the `CFBundleRef`. It is still worth stating: a bundle
/// with no executable here has nothing CoreFoundation can load, and saying so
/// by name beats a CoreFoundation error code.
pub fn macos_executable_path(bundle: &Path) -> Result<PathBuf, String> {
    let stem = bundle_stem(bundle)?;
    Ok(bundle.join("Contents").join("MacOS").join(stem))
}

// ── Platform module handles ─────────────────────────────────────────────

#[cfg(target_os = "macos")]
mod platform {
    use super::GET_PLUGIN_FACTORY;
    use core_foundation_sys::base::{CFRelease, CFTypeRef};
    use core_foundation_sys::bundle::{
        CFBundleCreate, CFBundleGetFunctionPointerForName, CFBundleLoadExecutableAndReturnError,
        CFBundleRef, CFBundleUnloadExecutable,
    };
    use core_foundation_sys::error::CFErrorRef;
    use core_foundation_sys::string::{
        kCFStringEncodingUTF8, CFStringCreateWithBytes, CFStringRef,
    };
    use core_foundation_sys::url::CFURLCreateFromFileSystemRepresentation;
    use std::ffi::c_void;
    use std::path::Path;

    type BundleEntry = unsafe extern "C" fn(CFBundleRef) -> bool;
    type BundleExit = unsafe extern "C" fn() -> bool;

    /// A loaded `.vst3` CFBundle whose `bundleEntry` has returned true.
    pub struct LoadedModule {
        bundle: CFBundleRef,
    }

    /// Wrap a UTF-8 symbol name as a `CFStringRef`, or `None` when
    /// CoreFoundation refuses it.
    unsafe fn symbol_name(name: &[u8]) -> Option<CFStringRef> {
        let string = CFStringCreateWithBytes(
            std::ptr::null(),
            name.as_ptr(),
            name.len() as isize,
            kCFStringEncodingUTF8,
            false as u8,
        );
        if string.is_null() {
            return None;
        }
        Some(string)
    }

    unsafe fn function_pointer(bundle: CFBundleRef, name: &[u8]) -> Option<*mut c_void> {
        let Some(symbol) = symbol_name(name) else {
            return None;
        };
        let pointer = CFBundleGetFunctionPointerForName(bundle, symbol);
        CFRelease(symbol as CFTypeRef);
        if pointer.is_null() {
            return None;
        }
        Some(pointer as *mut c_void)
    }

    impl LoadedModule {
        /// Create the bundle, load its executable, and run `bundleEntry`.
        ///
        /// `bundleEntry` returning false is a hard failure: the module has told
        /// the host it is not usable, and every later call would be made into a
        /// module that said so.
        pub fn open(bundle_path: &Path) -> Result<Self, String> {
            let path_bytes = bundle_path.as_os_str().as_encoded_bytes();
            unsafe {
                let url = CFURLCreateFromFileSystemRepresentation(
                    std::ptr::null(),
                    path_bytes.as_ptr(),
                    path_bytes.len() as isize,
                    true as u8,
                );
                if url.is_null() {
                    return Err(format!(
                        "VST3 bundle path is not a usable URL: {}",
                        bundle_path.display()
                    ));
                }
                let bundle = CFBundleCreate(std::ptr::null(), url);
                CFRelease(url as CFTypeRef);
                if bundle.is_null() {
                    return Err(format!(
                        "Not a loadable VST3 bundle: {}",
                        bundle_path.display()
                    ));
                }

                let mut error: CFErrorRef = std::ptr::null_mut();
                if CFBundleLoadExecutableAndReturnError(bundle, &mut error) == 0 {
                    if !error.is_null() {
                        CFRelease(error as CFTypeRef);
                    }
                    CFRelease(bundle as CFTypeRef);
                    return Err(format!(
                        "VST3 bundle executable could not be loaded: {}",
                        bundle_path.display()
                    ));
                }

                let Some(entry) = function_pointer(bundle, b"bundleEntry") else {
                    CFBundleUnloadExecutable(bundle);
                    CFRelease(bundle as CFTypeRef);
                    return Err(format!(
                        "VST3 bundle exports no bundleEntry: {}",
                        bundle_path.display()
                    ));
                };
                let entry: BundleEntry = std::mem::transmute(entry);
                if !entry(bundle) {
                    CFBundleUnloadExecutable(bundle);
                    CFRelease(bundle as CFTypeRef);
                    return Err(format!(
                        "VST3 bundle refused initialization: {}",
                        bundle_path.display()
                    ));
                }

                Ok(Self { bundle })
            }
        }

        pub fn plugin_factory_entry(&self) -> Option<*mut c_void> {
            unsafe {
                function_pointer(
                    self.bundle,
                    &GET_PLUGIN_FACTORY[..GET_PLUGIN_FACTORY.len() - 1],
                )
            }
        }
    }

    impl Drop for LoadedModule {
        fn drop(&mut self) {
            unsafe {
                if let Some(exit) = function_pointer(self.bundle, b"bundleExit") {
                    let exit: BundleExit = std::mem::transmute(exit);
                    exit();
                }
                CFBundleUnloadExecutable(self.bundle);
                CFRelease(self.bundle as CFTypeRef);
            }
        }
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use super::{windows_module_paths, GET_PLUGIN_FACTORY};
    use libloading::Library;
    use std::ffi::c_void;
    use std::path::Path;

    type InitDll = unsafe extern "system" fn() -> bool;
    type ExitDll = unsafe extern "system" fn() -> bool;

    pub struct LoadedModule {
        library: Library,
    }

    impl LoadedModule {
        /// `InitDll` is optional by the format's own rule, so its absence is not
        /// an error — but a present one returning false is, for the same reason
        /// it is on the other platforms.
        pub fn open(bundle_path: &Path) -> Result<Self, String> {
            let candidates = windows_module_paths(bundle_path, std::env::consts::ARCH)?;
            let mut last_error = format!(
                "VST3 bundle has no module for this architecture: {}",
                bundle_path.display()
            );
            for candidate in candidates {
                match unsafe { Library::new(&candidate) } {
                    Ok(library) => {
                        let module = Self { library };
                        if let Some(init) = module.symbol::<InitDll>(b"InitDll\0") {
                            if !unsafe { init() } {
                                return Err(format!(
                                    "VST3 module refused initialization: {}",
                                    candidate.display()
                                ));
                            }
                        }
                        return Ok(module);
                    }
                    Err(error) => {
                        last_error = format!("Cannot load {}: {error}", candidate.display());
                    }
                }
            }
            Err(last_error)
        }

        fn symbol<T>(&self, name: &[u8]) -> Option<T> {
            unsafe {
                self.library
                    .get::<T>(name)
                    .ok()
                    .map(|symbol| std::ptr::read(&*symbol as *const T))
            }
        }

        pub fn plugin_factory_entry(&self) -> Option<*mut c_void> {
            self.symbol::<*mut c_void>(GET_PLUGIN_FACTORY)
        }
    }

    impl Drop for LoadedModule {
        fn drop(&mut self) {
            if let Some(exit) = self.symbol::<ExitDll>(b"ExitDll\0") {
                unsafe { exit() };
            }
        }
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
mod platform {
    use super::{linux_module_path, GET_PLUGIN_FACTORY};
    use libloading::os::unix::Library;
    use std::ffi::c_void;
    use std::path::Path;

    type ModuleEntry = unsafe extern "C" fn(*mut c_void) -> bool;
    type ModuleExit = unsafe extern "C" fn() -> bool;

    pub struct LoadedModule {
        library: Library,
    }

    impl LoadedModule {
        /// `ModuleEntry` takes the module's own `dlopen` handle, which is why
        /// the raw handle is recovered here rather than kept opaque.
        pub fn open(bundle_path: &Path) -> Result<Self, String> {
            let Some(candidate) = linux_module_path(bundle_path, std::env::consts::ARCH)? else {
                return Err(format!(
                    "VST3 bundle has no module for this architecture: {}",
                    bundle_path.display()
                ));
            };
            let library = unsafe { Library::new(&candidate) }
                .map_err(|error| format!("Cannot load {}: {error}", candidate.display()))?;
            let handle = library.into_raw();
            let module = Self {
                library: unsafe { Library::from_raw(handle) },
            };

            let Some(entry) = module.symbol::<ModuleEntry>(b"ModuleEntry\0") else {
                return Err(format!(
                    "VST3 module exports no ModuleEntry: {}",
                    candidate.display()
                ));
            };
            if !unsafe { entry(handle) } {
                return Err(format!(
                    "VST3 module refused initialization: {}",
                    candidate.display()
                ));
            }
            Ok(module)
        }

        fn symbol<T>(&self, name: &[u8]) -> Option<T> {
            unsafe {
                self.library
                    .get::<T>(name)
                    .ok()
                    .map(|symbol| std::ptr::read(&*symbol as *const T))
            }
        }

        pub fn plugin_factory_entry(&self) -> Option<*mut c_void> {
            self.symbol::<*mut c_void>(GET_PLUGIN_FACTORY)
        }
    }

    impl Drop for LoadedModule {
        fn drop(&mut self) {
            if let Some(exit) = self.symbol::<ModuleExit>(b"ModuleExit\0") {
                unsafe { exit() };
            }
        }
    }
}

// ── The module a host holds ─────────────────────────────────────────────

type GetPluginFactory = unsafe extern "C" fn() -> *mut IPluginFactory;

/// One opened VST3 module and the factory it published.
///
/// **Field order is drop order and it is load bearing.** The format's teardown
/// order is: release the factory, run the module's exit function, unload. The
/// factory is declared first so its `Drop` runs before the platform handle's,
/// which is the one that runs exit and unload. Reordering these two calls the
/// module's exit while the host still holds a live reference into it.
pub struct Vst3Module {
    factory: ComPtr<IPluginFactory>,
    /// `None` once the module has been deliberately kept resident — see
    /// [`Vst3Module::open`] on `kComponentNonDiscardable`.
    ///
    /// Held for its `Drop` and never read: dropping it is what runs the module's
    /// exit function and unloads the image, and taking it is what makes a
    /// non-discardable module outlive this host object.
    #[allow(dead_code)]
    platform: Option<platform::LoadedModule>,
}

// SAFETY: a VST3 factory is required by the format to be callable from the
// host's threads, and this type hands out only `&self` access to it.
unsafe impl Send for Vst3Module {}
unsafe impl Sync for Vst3Module {}

impl Vst3Module {
    /// Load a bundle, run its entry point, and take its factory.
    ///
    /// `host_context` is handed to `IPluginFactory3::setHostContext` the moment
    /// the factory is in hand, because that is the only window in which a
    /// factory that needs host services has them before it is asked to create
    /// anything. A factory that is not an `IPluginFactory3` has no such call and
    /// is not an error.
    pub fn open(
        bundle_path: &Path,
        host_context: *mut vst3::Steinberg::FUnknown,
    ) -> Result<Arc<Self>, String> {
        let platform = platform::LoadedModule::open(bundle_path)?;
        let Some(entry) = platform.plugin_factory_entry() else {
            return Err(format!(
                "VST3 module exports no GetPluginFactory: {}",
                bundle_path.display()
            ));
        };
        let get_plugin_factory: GetPluginFactory = unsafe { std::mem::transmute(entry) };
        let factory = unsafe { ComPtr::from_raw(get_plugin_factory()) }.ok_or_else(|| {
            format!(
                "VST3 module returned no plugin factory: {}",
                bundle_path.display()
            )
        })?;

        set_host_context(&factory, host_context);

        let keep_resident = factory_is_non_discardable(&factory);
        Ok(Arc::new(Self {
            factory,
            // A module whose factory declares `kComponentNonDiscardable` states
            // that its classes must survive the factory's release, so the
            // handle is kept for the life of the process rather than unloaded.
            platform: if keep_resident {
                std::mem::forget(platform);
                None
            } else {
                Some(platform)
            },
        }))
    }

    pub fn factory(&self) -> &ComPtr<IPluginFactory> {
        &self.factory
    }
}

/// Hand the host context to a factory that can take one.
///
/// Free function rather than inline so the "only when it is an
/// `IPluginFactory3`" rule is stated once and can be read without the loading
/// code around it.
fn set_host_context(
    factory: &ComPtr<IPluginFactory>,
    host_context: *mut vst3::Steinberg::FUnknown,
) {
    if host_context.is_null() {
        return;
    }
    let Some(factory3) = factory.cast::<vst3::Steinberg::IPluginFactory3>() else {
        return;
    };
    unsafe {
        use vst3::Steinberg::IPluginFactory3Trait;
        factory3.setHostContext(host_context);
    }
}

/// Whether the factory declared that its classes may never be discarded.
pub fn factory_is_non_discardable(factory: &ComPtr<IPluginFactory>) -> bool {
    let Some(info) = factory_info(factory) else {
        return false;
    };
    info.flags & FactoryFlags_::kComponentNonDiscardable as i32 != 0
}

/// The factory's own `PFactoryInfo`, or `None` when it refuses to describe
/// itself.
pub fn factory_info(factory: &ComPtr<IPluginFactory>) -> Option<PFactoryInfo> {
    let mut info: PFactoryInfo = unsafe { std::mem::zeroed() };
    let result = unsafe { factory.getFactoryInfo(&mut info) };
    if result != vst3::Steinberg::kResultOk {
        return None;
    }
    Some(info)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_windows_arm_host_probes_the_recommended_arm64x_directory_first() {
        let paths = windows_module_paths(Path::new("/plugins/Reverb.vst3"), "aarch64")
            .expect("a named bundle should probe");

        assert_eq!(
            paths,
            vec![
                PathBuf::from("/plugins/Reverb.vst3/Contents/arm64x-win/Reverb.vst3"),
                PathBuf::from("/plugins/Reverb.vst3/Contents/arm64-win/Reverb.vst3"),
            ],
            "a bundle that shipped only the recommended arm64x image must still be found"
        );
    }

    /// ARM64EC images exist to run inside an x64-emulated process. Loading one
    /// into a native ARM64 host is the wrong image, not a fallback.
    #[test]
    fn a_windows_arm_host_never_probes_the_emulation_compatible_image() {
        assert!(!windows_architecture_directories("aarch64").contains(&"arm64ec-win"));
    }

    #[test]
    fn a_windows_x86_64_host_probes_only_its_own_architecture() {
        let paths = windows_module_paths(Path::new("/plugins/Reverb.vst3"), "x86_64")
            .expect("a named bundle should probe");

        assert_eq!(
            paths,
            vec![PathBuf::from(
                "/plugins/Reverb.vst3/Contents/x86_64-win/Reverb.vst3"
            )]
        );
    }

    #[test]
    fn an_unknown_windows_architecture_probes_nothing_rather_than_guessing() {
        assert!(
            windows_module_paths(Path::new("/plugins/Reverb.vst3"), "powerpc64")
                .expect("a named bundle should probe")
                .is_empty()
        );
    }

    /// The inner file carries the bundle's name and the `.vst3` suffix — a
    /// probe that looked for `<name>.dll` finds nothing in any real bundle.
    #[test]
    fn the_windows_module_file_repeats_the_bundle_name_and_suffix() {
        let paths = windows_module_paths(Path::new("/plugins/My Synth.vst3"), "x86_64")
            .expect("a named bundle should probe");

        assert_eq!(
            paths[0].file_name().and_then(|name| name.to_str()),
            Some("My Synth.vst3")
        );
    }

    /// `uname -m` and Rust's own architecture names disagree here, and the
    /// directory is named after the former.
    #[test]
    fn the_linux_directory_uses_the_uname_spelling_not_the_rust_one() {
        assert_eq!(linux_machine_directory("arm"), Some("armv7l"));
        assert_eq!(linux_machine_directory("x86"), Some("i386"));
        assert_eq!(linux_machine_directory("x86_64"), Some("x86_64"));
        assert_eq!(linux_machine_directory("aarch64"), Some("aarch64"));
        assert_eq!(linux_machine_directory("powerpc64"), None);
    }

    #[test]
    fn the_linux_module_lives_under_a_machine_named_directory() {
        assert_eq!(
            linux_module_path(Path::new("/usr/lib/vst3/Reverb.vst3"), "x86_64")
                .expect("a named bundle should probe"),
            Some(PathBuf::from(
                "/usr/lib/vst3/Reverb.vst3/Contents/x86_64-linux/Reverb.so"
            ))
        );
        assert_eq!(
            linux_module_path(Path::new("/usr/lib/vst3/Reverb.vst3"), "powerpc64")
                .expect("a named bundle should probe"),
            None
        );
    }

    #[test]
    fn the_macos_executable_lives_under_contents_macos() {
        assert_eq!(
            macos_executable_path(Path::new("/Library/Audio/Plug-Ins/VST3/Reverb.vst3"))
                .expect("a named bundle should probe"),
            PathBuf::from("/Library/Audio/Plug-Ins/VST3/Reverb.vst3/Contents/MacOS/Reverb")
        );
    }

    /// 3.7.5 through 3.7.7 wrote `Contents/moduleinfo.json`; 3.7.8 moved it to
    /// `Contents/Resources`. Probing only one loses every plugin built against
    /// the other.
    #[test]
    fn both_module_info_locations_are_probed_newest_first() {
        assert_eq!(
            module_info_paths(Path::new("/plugins/Reverb.vst3")),
            [
                PathBuf::from("/plugins/Reverb.vst3/Contents/Resources/moduleinfo.json"),
                PathBuf::from("/plugins/Reverb.vst3/Contents/moduleinfo.json"),
            ]
        );
    }

    #[test]
    fn a_bundle_with_no_name_is_refused_rather_than_probed() {
        assert!(windows_module_paths(Path::new("/"), "x86_64").is_err());
        assert!(macos_executable_path(Path::new("/")).is_err());
    }
}
