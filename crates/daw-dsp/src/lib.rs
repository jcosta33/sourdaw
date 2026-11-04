// Native consumers retain every runtime API even when they need only primitives in WASM.
#[cfg(any(not(target_arch = "wasm32"), feature = "wasm-runtime"))]
pub mod bacteria;
#[cfg(any(not(target_arch = "wasm32"), feature = "wasm-runtime"))]
pub mod crumbs;
#[cfg(any(not(target_arch = "wasm32"), feature = "wasm-runtime"))]
pub mod crust;
#[cfg(any(not(target_arch = "wasm32"), feature = "wasm-runtime"))]
pub mod fermenter;
#[cfg(any(not(target_arch = "wasm32"), feature = "wasm-runtime"))]
pub mod gluten;
#[cfg(any(not(target_arch = "wasm32"), feature = "wasm-runtime"))]
pub mod grand_boule;
#[cfg(any(not(target_arch = "wasm32"), feature = "wasm-runtime"))]
pub mod grinder;
#[cfg(any(not(target_arch = "wasm32"), feature = "wasm-runtime"))]
pub mod knead;
#[cfg(any(not(target_arch = "wasm32"), feature = "wasm-runtime"))]
pub mod levain;
#[cfg(any(not(target_arch = "wasm32"), feature = "wasm-runtime"))]
pub mod params;
pub mod primitives;
#[cfg(any(not(target_arch = "wasm32"), feature = "wasm-runtime"))]
pub mod proof;
#[cfg(any(not(target_arch = "wasm32"), feature = "wasm-runtime"))]
pub mod toaster;

/// Install `console_error_panic_hook` once at wasm module init so a Rust panic
/// surfaces a readable message on the JS console instead of an opaque
/// `unreachable` trap that silently poisons the AudioWorklet instance (WB-6).
/// Wasm-only by construction; the native build is unaffected.
#[cfg(all(target_arch = "wasm32", feature = "wasm-runtime"))]
#[wasm_bindgen::prelude::wasm_bindgen(start)]
fn init_panic_hook() {
    console_error_panic_hook::set_once();
}
