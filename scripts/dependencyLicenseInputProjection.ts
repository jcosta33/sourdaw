/**
 * The bytes of each licence-proof input that can change the generated dependency licence proof.
 *
 * `release/dependency-license-proofs.json` and `release/open-source-inventory.json` pin the
 * manifests the licence generator resolves from. A whole-file digest made every unrelated edit —
 * a new `package.json` script, a crate `version` or `description`, a `[lints]` table, a comment —
 * restamp both files, so unrelated pull requests conflicted there. Each projection below renders
 * only what the generator or `cargo metadata --features <runtime set>` can read, so the pin still
 * moves for every change that can alter the proof and for nothing else:
 *
 * - a `Cargo.toml` is parsed as TOML and keeps every dependency table (normal, `dev-`, `build-`,
 *   `target.*.`, and `[workspace.dependencies]`), `[features]`, `[patch]`, `[replace]`,
 *   `[workspace]` `members`, `exclude`, `default-members` and `resolver`, `package.resolver`, and
 *   the `license`/`license-file` keys of `[package]` and `[workspace.package]`, workspace-inherited
 *   and underscore-separated forms included, rendered as canonical JSON. Parsing rather than line
 *   matching means quoting, escapes, comments and multi-line strings mean what Cargo reads them as.
 *   Any other key ending in `dependencies` outside `package.metadata` and `workspace.metadata` fails closed, so a table spelling
 *   the selection does not know cannot reach the graph unpinned, and an unparseable manifest fails
 *   closed too. Members are the roots the runtime graph walks from, so a new member brings its
 *   dependencies into the proof. Dev-dependencies stay because `cargo metadata` unifies features
 *   across dependency kinds: a dev-dependency that enables an optional dependency adds a normal edge
 *   to the runtime graph.
 * - `package.json` keeps `license` and `scripts.build`, the only fields the generator reads.
 *
 * Every other input is pinned whole, `electron-builder.yml` included: electron-builder applies its
 * `files` patterns in order, so a later pattern can re-include `node_modules` past the exclusion
 * the generator matches, and no line projection sees that.
 */

import { createHash } from 'node:crypto';
import { posix } from 'node:path';

import { parse as parseToml, type TomlTable, type TomlValue } from 'smol-toml';

import { canonicalJson, type JsonValue } from './canonicalRecord.ts';
import { parseJsonWithUniqueKeys } from './strictJson.ts';

export const LICENCE_INPUT_PROJECTIONS = [
    'cargo-manifest-licence-graph',
    'package-json-licence-fields',
    'whole-file',
] as const;

export type LicenceInputProjection = (typeof LICENCE_INPUT_PROJECTIONS)[number];

export type LicenceInputDigest = { projection: LicenceInputProjection; sha256: string };

/** The packaging line that keeps `node_modules` out of the desktop bundle; the generator relies on it. */
export const ELECTRON_NODE_MODULES_EXCLUSION_PATTERN = /^\s*- '!node_modules\/\*\*\/\*'$/u;

/**
 * What the licence graph reads from a parsed manifest, by key: `keep` projects the value whole,
 * `ignore` drops a table Cargo leaves to other tools, a nested selection descends, and `*` matches
 * any key (the `cfg` of a `[target.<cfg>]` table). Keys match after `_` becomes `-`: Cargo reads
 * `[dev_dependencies]` or `default_members` as the hyphenated spelling (deprecated, accepted before
 * the 2024 edition), and projecting an underscore spelling Cargo ignores costs only a spurious restamp.
 */
type CargoSelection = 'keep' | 'ignore' | { readonly [key: string]: CargoSelection };

const CARGO_DEPENDENCY_TABLES = {
    dependencies: 'keep',
    'dev-dependencies': 'keep',
    'build-dependencies': 'keep',
} as const satisfies CargoSelection;

const CARGO_LICENCE_GRAPH_SELECTION: CargoSelection = {
    ...CARGO_DEPENDENCY_TABLES,
    features: 'keep',
    patch: 'keep',
    replace: 'keep',
    target: { '*': CARGO_DEPENDENCY_TABLES },
    package: { license: 'keep', 'license-file': 'keep', resolver: 'keep', metadata: 'ignore' },
    workspace: {
        members: 'keep',
        exclude: 'keep',
        'default-members': 'keep',
        resolver: 'keep',
        dependencies: 'keep',
        package: { license: 'keep', 'license-file': 'keep' },
        metadata: 'ignore',
    },
};

const TOML_BARE_KEY_PATTERN = /^[A-Za-z0-9_-]+$/u;
const CARGO_WORKSPACE_MEMBER_GLOB_PATTERN = /[*?[\]]/u;

export function licenceInputProjectionKind(path: string): LicenceInputProjection {
    if (path === 'Cargo.toml' || path.endsWith('/Cargo.toml')) {
        return 'cargo-manifest-licence-graph';
    }
    if (path === 'package.json') {
        return 'package-json-licence-fields';
    }
    return 'whole-file';
}

function parseCargoManifest(text: string, path: string): TomlTable {
    try {
        return parseToml(text, { unsafeKeyBehaviour: 'throw' });
    } catch (error) {
        const reason = error instanceof Error ? (error.message.split('\n')[0] ?? '') : String(error);
        throw new Error(`${path}: unparseable Cargo manifest: ${reason}`, { cause: error });
    }
}

function isTomlTable(value: TomlValue): value is TomlTable {
    return typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);
}

function normalizedCargoKey(key: string): string {
    return key.replaceAll('_', '-');
}

/** A dotted key path as TOML would spell it, so an error names the key the manifest wrote. */
function tomlKeyPath(segments: readonly string[]): string {
    return segments
        .map((segment) => (TOML_BARE_KEY_PATTERN.test(segment) ? segment : JSON.stringify(segment)))
        .join('.');
}

function tomlJsonValue(value: TomlValue): JsonValue {
    if (Array.isArray(value)) {
        return value.map((entry) => tomlJsonValue(entry));
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    if (typeof value === 'bigint') {
        return value.toString();
    }
    if (typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, tomlJsonValue(entry)]));
    }
    return value;
}

/** Fails on any key ending in `dependencies` below an unselected key: a spelling the selection does not know. */
function assertNoDependencyKeys(value: TomlValue, segments: readonly string[], path: string): void {
    if (Array.isArray(value)) {
        for (const entry of value) {
            assertNoDependencyKeys(entry, segments, path);
        }
        return;
    }
    if (!isTomlTable(value)) {
        return;
    }
    for (const [key, entry] of Object.entries(value)) {
        const keySegments = [...segments, key];
        if (normalizedCargoKey(key).endsWith('dependencies')) {
            throw new Error(`${path}: unrecognised dependency table key ${tomlKeyPath(keySegments)}`);
        }
        assertNoDependencyKeys(entry, keySegments, path);
    }
}

function selectCargoKeys(
    table: TomlTable,
    selection: { readonly [key: string]: CargoSelection },
    segments: readonly string[],
    path: string
): { [key: string]: JsonValue } {
    const projection: { [key: string]: JsonValue } = {};
    for (const [key, value] of Object.entries(table)) {
        const keySegments = [...segments, key];
        const keySelection = selection[normalizedCargoKey(key)] ?? selection['*'];
        if (keySelection === undefined) {
            if (normalizedCargoKey(key).endsWith('dependencies')) {
                throw new Error(`${path}: unrecognised dependency table key ${tomlKeyPath(keySegments)}`);
            }
            assertNoDependencyKeys(value, keySegments, path);
            continue;
        }
        if (keySelection === 'ignore') {
            continue;
        }
        if (keySelection === 'keep') {
            projection[key] = tomlJsonValue(value);
            continue;
        }
        if (!isTomlTable(value)) {
            throw new Error(`${path}: Cargo manifest key ${tomlKeyPath(keySegments)} must be a table`);
        }
        projection[key] = selectCargoKeys(value, keySelection, keySegments, path);
    }
    return projection;
}

/**
 * The canonical JSON of the parts of a Cargo manifest that reach the runtime licence graph.
 * Canonical key order makes key and table order irrelevant, as it is to Cargo.
 */
export function cargoManifestLicenceGraphProjection(text: string, path: string): string {
    const manifest = parseCargoManifest(text, path);
    return `${canonicalJson(selectCargoKeys(manifest, CARGO_LICENCE_GRAPH_SELECTION, [], path))}\n`;
}

/**
 * The repository-relative manifest path of every `[workspace] members` entry of a root manifest.
 * Glob members fail closed: no Sourdaw workspace uses one, and expanding them here would need
 * Cargo's own glob and `exclude` semantics.
 */
export function cargoWorkspaceMemberManifestPaths(text: string, path: string): string[] {
    const workspace = parseCargoManifest(text, path).workspace;
    if (workspace === undefined) {
        return [];
    }
    if (!isTomlTable(workspace)) {
        throw new Error(`${path}: Cargo manifest key workspace must be a table`);
    }
    const members = workspace.members ?? [];
    if (!Array.isArray(members)) {
        throw new TypeError(`${path}: workspace.members must be an array of strings`);
    }
    return members.map((member) => {
        if (typeof member !== 'string') {
            throw new TypeError(`${path}: workspace.members must be an array of strings`);
        }
        if (CARGO_WORKSPACE_MEMBER_GLOB_PATTERN.test(member)) {
            throw new Error(`${path}: glob workspace member ${member} is not supported by the licence inputs`);
        }
        return posix.join(member, 'Cargo.toml');
    });
}

export function packageJsonLicenceFieldsProjection(text: string, path: string): string {
    const manifest = parseJsonWithUniqueKeys<{ license?: JsonValue; scripts?: { build?: JsonValue } }>(text, path);
    return `${canonicalJson({ license: manifest.license ?? null, scripts: { build: manifest.scripts?.build ?? null } })}\n`;
}

function projectedBytes(path: string, projection: LicenceInputProjection, bytes: Buffer): Buffer {
    if (projection === 'whole-file') {
        return bytes;
    }
    const text = bytes.toString('utf8');
    if (projection === 'cargo-manifest-licence-graph') {
        return Buffer.from(cargoManifestLicenceGraphProjection(text, path), 'utf8');
    }
    return Buffer.from(packageJsonLicenceFieldsProjection(text, path), 'utf8');
}

/** The projection `path` is pinned by and the SHA-256 of that projection of `bytes`. */
export function licenceInputDigest(path: string, bytes: Buffer): LicenceInputDigest {
    const projection = licenceInputProjectionKind(path);
    return {
        projection,
        sha256: createHash('sha256')
            .update(projectedBytes(path, projection, bytes))
            .digest('hex'),
    };
}

/**
 * Canonical bytes of the hand-curated part of the proof manifest: its `packages` proofs. Every
 * other field is generated from live inputs and checked against them by the licence preflight.
 */
export function curatedDependencyLicenseProofsProjection(text: string, path: string): string {
    const manifest = parseJsonWithUniqueKeys<{ packages?: JsonValue }>(text, path);
    const packages = manifest.packages;
    if (packages === undefined || packages === null || typeof packages !== 'object' || Array.isArray(packages)) {
        throw new Error(`${path}: proof manifest packages must be an object`);
    }
    return `${canonicalJson({ packages })}\n`;
}
