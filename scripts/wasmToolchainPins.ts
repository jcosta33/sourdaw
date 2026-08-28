/**
 * Constants for the toolchain parts with no independent in-repo source to verify
 * against: the `wasm-pack` CLI version and the `wasm-opt` (binaryen) it bundles.
 * `wasm-bindgen` is read live from `Cargo.lock` and the rust toolchain from
 * `rust-toolchain.toml`, so those are not hard-coded here (WB-8).
 *
 * Standalone on purpose: the Grand Boule measurement census (ADR 0038) pins the
 * toolchain inputs by file digest, and a block inside `wasm-artifacts.ts` would
 * re-couple every artifact-list edit there to a reference-machine re-measurement.
 */
export const wasmToolchainPins = {
    wasmPack: '0.14.0',
    wasmOpt: 'bundled-by-wasm-pack@0.14.0',
} as const;
