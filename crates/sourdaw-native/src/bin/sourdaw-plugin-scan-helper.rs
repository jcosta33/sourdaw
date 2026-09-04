//! The Sourdaw plugin-scan leaf helper.
//!
//! The application binary, in a packaged build, is the Electron runtime — and
//! packaging fuses its Node role off (`scripts/flipElectronFuses.ts`,
//! `RunAsNode: false`), so it can never again be re-executed as a plain
//! interpreter to run a script. The plugin-scan leaf worker used to depend on
//! exactly that re-entry (`ELECTRON_RUN_AS_NODE=1 <electron> scanWorker.js`);
//! under the fuse the child silently starts the full application instead,
//! never inspects the plugin, and every scan times out. This executable
//! exists so the leaf never needs the application runtime at all: it is a
//! standalone process that does nothing but read the bounded scan-worker
//! argument contract and extract one plugin's metadata, over
//! `sourdaw_native::run_plugin_scan_worker_from_process_args`.
//!
//! This binary shares its package with `sourdaw-native`'s `cdylib` Node
//! addon, and this workspace's release profile builds with `lto = true`
//! while `.cargo/config.toml` sets `-Cembed-bitcode=no` globally — a
//! combination `rustc` refuses for a final-linked `bin` crate-type artifact
//! (an `rlib` or `cdylib` under the same flags links fine). Cargo has no
//! per-package `lto` override, only a whole-profile one, so
//! `scripts/buildNativeAddon.ts` builds the addon with `--lib` (never
//! building this bin under the LTO profile) and builds this bin separately
//! with the `CARGO_PROFILE_RELEASE_LTO=false` environment override — Cargo's
//! documented per-invocation profile-key override — under its own
//! `--target-dir` so the two LTO settings never invalidate each other's
//! build caches. That keeps the workspace's `Cargo.toml`, its wasm
//! source-hash closure, and `Cargo.lock` untouched by this executable's own
//! build requirements.
//!
//! The scan policy in `crates/sourdaw-native/src/host/plugin_scan_worker.rs`
//! names this binary through `SOURDAW_PLUGIN_SCAN_WORKER_COMMAND`
//! (`electron/scanWorker.ts`) and launches it directly — no shell runtime,
//! Electron or otherwise, is ever re-entered to inspect a plugin.
//!
//! Started with no worker marker in its arguments, this process is not being
//! asked to scan anything: it prints why it exists to stderr and exits 2
//! rather than silently doing nothing.

fn main() {
    match sourdaw_native::run_plugin_scan_worker_from_process_args() {
        Some(exit_code) => std::process::exit(exit_code),
        None => {
            eprintln!(
                "sourdaw-plugin-scan-helper is the Sourdaw plugin scan helper executable; \
                 it is launched by the application and is not meant to be run directly."
            );
            std::process::exit(2);
        }
    }
}
