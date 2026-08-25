pub mod bacteria;
pub mod crumbs;
pub mod crust;
pub mod fermenter;
pub mod gluten;
pub mod grand_boule;
pub mod grinder;
pub mod knead;
pub mod levain;
pub mod primitives;
pub mod proof;
pub mod toaster;

/// Install `console_error_panic_hook` once at wasm module init so a Rust panic
/// surfaces a readable message on the JS console instead of an opaque
/// `unreachable` trap that silently poisons the AudioWorklet instance (WB-6).
/// Wasm-only by construction; the native build is unaffected.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen::prelude::wasm_bindgen(start)]
fn init_panic_hook() {
    console_error_panic_hook::set_once();
}
