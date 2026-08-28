import { execFileSync } from 'node:child_process';

/**
 * The Grand Boule measurement census (ADR 0038): exactly the source inputs
 * that determine grand_boule codegen. `run.mjs` records one sha256 per path
 * into the retained table and `assertGrandBouleMeasurementAdmission`
 * re-derives the same census to compare against, so both sides import this
 * one list — two independently maintained copies is the drift ADR 0015
 * rule 2 warns about.
 */
export const GRAND_BOULE_MEASUREMENT_SOURCE_FILES = [
    'crates/daw-dsp/benches/quantum.rs',
    'crates/daw-dsp/benches/wasm/deviceRecipes.js',
    'crates/daw-dsp/benches/wasm/quantumCostProcessor.js',
    'crates/daw-dsp/src/lib.rs',
    'crates/daw-dsp/Cargo.toml',
    'rust-toolchain.toml',
];

export const GRAND_BOULE_MEASUREMENT_SOURCE_DIRECTORIES = [
    'crates/daw-dsp/src/grand_boule',
    'crates/daw-dsp/src/primitives',
];

/**
 * Sorted repo-relative census paths: the explicit files plus every tracked
 * file under the census directories, recursing into `time_stretch`.
 */
export function grandBouleMeasurementSourcePaths(root) {
    const directoryFiles = execFileSync(
        'git',
        ['ls-files', '-z', '--', ...GRAND_BOULE_MEASUREMENT_SOURCE_DIRECTORIES],
        { cwd: root, encoding: 'utf8' }
    )
        .split('\0')
        .filter(Boolean);
    return [...GRAND_BOULE_MEASUREMENT_SOURCE_FILES, ...directoryFiles].sort();
}
