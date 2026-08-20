fn main() {
    // Only the Node addon build needs napi's link arguments. A plain rlib
    // consumer (tests, tooling) must not inherit them.
    if std::env::var_os("CARGO_FEATURE_NAPI_ADDON").is_some() {
        napi_build::setup();
    }
}
