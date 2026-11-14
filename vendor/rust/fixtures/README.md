# Rust consumer fixtures

Run these standalone consumers through the repository resource guard with the pinned Rust toolchain and at most two Cargo jobs. They are excluded from the application workspace, so upstream development suites do not become application members.

- `cargo test --manifest-path vendor/rust/fixtures/Cargo.toml --tests -- --test-threads=2` observes expression values, remainder/error slice identity, generated enum conversions, visibility and unsafe function signatures, and real tracing spans/events when async bodies are polled.
- `python3 vendor/rust/fixtures/check-rejections.py` requires the intended diagnostic for each invalid consumer example; unrelated compilation failures do not count as successful rejection.
- `cargo test --manifest-path vendor/rust/fixtures/bindgen-abi/Cargo.toml tests:: -- --test-threads=2` generates bindings from the bundled Whisper headers and compares Rust layout and a callback call against real C. `WHISPER_DONT_GENERATE_BINDINGS` must be absent. It runs no model inference.
- `cargo test --manifest-path vendor/rust/fixtures/loader-lifecycle/Cargo.toml --lib -- --test-threads=1` uses the real application CLAP loader and two compiled dynamic libraries to observe refusal, entry cleanup and image unload. Its teardown fixture requires Mach-O or ELF; it proves neither a working plugin's DSP/editor nor Windows loader behavior.

The expression exponent cases retain valid leading-dot C literals and reject malformed exponents. The published parser tried a decimal prefix before its exponent alternatives, so `.25e2F` failed even before the Nom migration; the port orders the longer forms first.

Native Windows ABI, Linux ALSA timestamps, Android lifecycle, device hardware, and platform proxy discovery need their corresponding real platform checks. These bounded consumers cannot substitute for them.
