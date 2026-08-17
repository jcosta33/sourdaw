fn main() {
    // Only the Node addon build needs napi's link arguments. The Tauri shell
    // links this crate as a plain rlib and must not inherit them.
    if std::env::var_os("CARGO_FEATURE_NAPI_ADDON").is_some() {
        napi_build::setup();
    }
}
