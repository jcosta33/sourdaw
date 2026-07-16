---
type: spec
id: SPEC-native-build-reproducibility
title: Native build configuration ownership
status: draft
owner: The Sourdaw team
sources:
    - ../../../Cargo.toml
    - ../../../.cargo/config.toml
    - ../../../rust-toolchain.toml
    - ../../../src-tauri/.cargo/config.toml
---

# Native build configuration ownership

## Intent

Keep ownership of the repository-declared Rust toolchain, release profiles, and
shared Rust flags explicit. Successful or portable native builds are outside
this spec.

## Requirements

### AC-001 - The repository pins its native toolchain

The repository MUST declare an exact Rust toolchain in a root-owned
`rust-toolchain.toml`, including the components required by repository checks
(`rustfmt` and `clippy`), so root `cargo` commands do not depend on ambient
developer toolchain selection.

Verify with: `declared="$(sed -n 's/^channel = "\(.*\)"$/\1/p' rust-toolchain.toml)" && active="$(rustup show active-toolchain)" && test -n "$declared" && test "${active#"$declared"-}" != "$active" && cargo +"$declared" fmt --version && cargo +"$declared" clippy --version`

### AC-002 - Workspace release profiles have one owner

The workspace root MUST be the only Cargo manifest that defines release profile
settings; member manifests contain no competing profile tables.

Verify with: `test "$(git ls-files --cached --others --exclude-standard ':(glob)**/Cargo.toml' -z | xargs -0 rg -l '^\[profile\.' | sort)" = 'Cargo.toml'`

### AC-003 - Shared Rust flags have one owner

The workspace-root Cargo config MUST be the only Cargo config that declares
shared Rust flags; nested config contains no competing flags.

Verify with: `test "$(git ls-files --cached --others --exclude-standard ':(glob)**/.cargo/config.toml' -z | xargs -0 rg -l '^rustflags' | sort)" = '.cargo/config.toml'`
