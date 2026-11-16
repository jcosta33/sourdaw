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
 * - a `Cargo.toml` keeps every dependency table (normal, `dev-`, `build-`, `target.*.`, and
 *   `[workspace.dependencies]`), `[features]`, `[patch*]`, `[replace]`, `[workspace]` `members`,
 *   `exclude`, `default-members` and `resolver`, and the `license`/`license-file` keys of
 *   `[package]` and `[workspace.package]`, workspace-inherited and underscore-separated forms
 *   included. Keys match after TOML unquoting, so `["dependencies"]` or `"features".x` count as the
 *   bare spelling Cargo reads them as. Any other key segment ending in `dependencies` outside `[*.metadata]` fails closed,
 *   so a table spelling the projection does not know cannot reach the graph unpinned. Members are the
 *   roots the runtime graph walks from, so a new member brings its dependencies into the proof.
 *   Dev-dependencies stay because `cargo metadata` unifies features across dependency kinds: a
 *   dev-dependency that enables an optional dependency adds a normal edge to the runtime graph.
 * - `package.json` keeps `license` and `scripts.build`, the only fields the generator reads.
 * - `electron-builder.yml` keeps the `node_modules` exclusion lines the generator matches.
 *
 * Every other input is pinned whole. The TOML scanner is the canonical one in
 * `workspaceManifestFingerprint.ts`; it is line-oriented, so a manifest shape it cannot read
 * fails closed instead of narrowing the projection.
 */

import { createHash } from 'node:crypto';

import { canonicalJson, type JsonValue } from './canonicalRecord.ts';
import { parseJsonWithUniqueKeys } from './strictJson.ts';
import { tomlTableLines } from './workspaceManifestFingerprint.ts';

export const LICENCE_INPUT_PROJECTIONS = [
    'cargo-manifest-licence-graph',
    'package-json-licence-fields',
    'electron-builder-node-modules-exclusion',
    'whole-file',
] as const;

export type LicenceInputProjection = (typeof LICENCE_INPUT_PROJECTIONS)[number];

export type LicenceInputDigest = { projection: LicenceInputProjection; sha256: string };

/** The packaging line that keeps `node_modules` out of the desktop bundle; the generator relies on it. */
export const ELECTRON_NODE_MODULES_EXCLUSION_PATTERN = /^\s*- '!node_modules\/\*\*\/\*'$/u;

// Each multi-word key accepts `_` as well as `-`: Cargo reads `[dev_dependencies]` and
// `[build_dependencies]` as the hyphenated tables (deprecated, accepted before the 2024 edition),
// and projecting an underscore spelling Cargo ignores costs only a spurious restamp.
const CARGO_DEPENDENCY_KEY_PATTERN = /(?:^|\.)(?:dependencies|dev[-_]dependencies|build[-_]dependencies)(?:\.|$)/u;
const CARGO_FEATURES_KEY_PATTERN = /^features(?:\.|$)/u;
const CARGO_SOURCE_OVERRIDE_KEY_PATTERN = /^(?:patch|replace)(?:\.|$)/u;
const CARGO_WORKSPACE_GRAPH_KEY_PATTERN = /^workspace\.(?:members|exclude|default[-_]members|resolver)$/u;
const CARGO_PACKAGE_LICENCE_KEY_PATTERN = /^(?:package|workspace\.package)\.(?:license|license[-_]file)(?:\.|$)/u;
const CARGO_PACKAGE_RESOLVER_KEY = 'package.resolver';
/** A key segment naming a dependency table; one the patterns above miss is a spelling they do not know. */
const CARGO_DEPENDENCY_SEGMENT_PATTERN = /(?:^|\.)[^.]*dependencies(?:\.|$)/u;
/** Tables Cargo ignores and leaves to other tools, so any key may live there. */
const CARGO_METADATA_KEY_PATTERN = /^(?:package|workspace)\.metadata(?:\.|$)/u;

export function licenceInputProjectionKind(path: string): LicenceInputProjection {
    if (path === 'Cargo.toml' || path.endsWith('/Cargo.toml')) {
        return 'cargo-manifest-licence-graph';
    }
    if (path === 'package.json') {
        return 'package-json-licence-fields';
    }
    if (path === 'electron-builder.yml') {
        return 'electron-builder-node-modules-exclusion';
    }
    return 'whole-file';
}

const TOML_BASIC_STRING_ESCAPES: Readonly<Record<string, string>> = {
    b: '\b',
    t: '\t',
    n: '\n',
    f: '\f',
    r: '\r',
    e: '\u001B',
    '"': '"',
    '\\': '\\',
};
const TOML_BARE_KEY_CHARACTER_PATTERN = /^[A-Za-z0-9_-]$/u;
const TOML_UNICODE_ESCAPE_DIGIT_COUNTS: Readonly<Record<string, number>> = { u: 4, U: 8 };

type TomlKeySegmentScan = { segment: string; end: number };

/** The decoded value of the basic string key segment (`"..."`) whose opening quote sits at `start`. */
function scanTomlBasicStringSegment(text: string, start: number, failure: () => Error): TomlKeySegmentScan {
    let segment = '';
    let index = start + 1;
    while (index < text.length) {
        const char = text.charAt(index);
        if (char === '"') {
            return { segment, end: index + 1 };
        }
        if (char !== '\\') {
            segment += char;
            index += 1;
            continue;
        }
        const escape = text.charAt(index + 1);
        const digitCount = TOML_UNICODE_ESCAPE_DIGIT_COUNTS[escape];
        if (digitCount !== undefined) {
            const digits = text.slice(index + 2, index + 2 + digitCount);
            if (!new RegExp(`^[0-9A-Fa-f]{${digitCount}}$`, 'u').test(digits)) {
                throw failure();
            }
            segment += String.fromCodePoint(Number.parseInt(digits, 16));
            index += 2 + digitCount;
            continue;
        }
        const decoded = TOML_BASIC_STRING_ESCAPES[escape];
        if (decoded === undefined) {
            throw failure();
        }
        segment += decoded;
        index += 2;
    }
    throw failure();
}

/** One key segment at `start`: a basic string, a literal string (`'...'`, taken verbatim), or a bare key. */
function scanTomlKeySegment(text: string, start: number, failure: () => Error): TomlKeySegmentScan {
    const opening = text.charAt(start);
    if (opening === '"') {
        return scanTomlBasicStringSegment(text, start, failure);
    }
    if (opening === "'") {
        const closing = text.indexOf("'", start + 1);
        if (closing === -1) {
            throw failure();
        }
        return { segment: text.slice(start + 1, closing), end: closing + 1 };
    }
    let end = start;
    while (end < text.length && TOML_BARE_KEY_CHARACTER_PATTERN.test(text.charAt(end))) {
        end += 1;
    }
    if (end === start) {
        throw failure();
    }
    return { segment: text.slice(start, end), end };
}

function skipTomlWhitespace(text: string, start: number): number {
    let index = start;
    while (text.charAt(index) === ' ' || text.charAt(index) === '\t') {
        index += 1;
    }
    return index;
}

/**
 * The unquoted segments of the dotted TOML key at the start of `text`, and the index just past it
 * and any trailing whitespace. A dot inside a quoted segment stays in it, so
 * `'cfg(target_os = "macos")'` is one segment.
 */
function scanTomlDottedKey(text: string, failure: () => Error): { segments: string[]; end: number } {
    const segments: string[] = [];
    let index = skipTomlWhitespace(text, 0);
    for (;;) {
        const scanned = scanTomlKeySegment(text, index, failure);
        segments.push(scanned.segment);
        index = skipTomlWhitespace(text, scanned.end);
        if (text.charAt(index) !== '.') {
            return { segments, end: index };
        }
        index = skipTomlWhitespace(text, index + 1);
    }
}

/** `[header]` and the key of one content line, whitespace around dots removed, as written. */
function cargoRawKeyPath(header: string, line: string): string {
    const key = line.slice(0, Math.max(line.indexOf('='), 0)).trim();
    const trimmedHeader = header.trim();
    return (trimmedHeader === '' ? key : `${trimmedHeader}.${key}`).replaceAll(/\s*\.\s*/gu, '.');
}

/**
 * `[header]` and the key of one content line as one dotted path of unquoted segments, so a quoted
 * spelling such as `["dependencies"]` or `"features".x` matches the patterns as Cargo reads it.
 */
function cargoKeyPath(header: string, line: string, path: string): string {
    const trimmedHeader = header.trim();
    // `[[bin]]` reaches here as `[bin]`: an array of tables matches like a table.
    const tableName =
        trimmedHeader.startsWith('[') && trimmedHeader.endsWith(']') ? trimmedHeader.slice(1, -1) : trimmedHeader;
    const headerFailure = (): Error => new Error(`${path}: unreadable Cargo manifest header [${header}]`);
    const headerSegments: string[] = [];
    if (tableName.trim() !== '') {
        const scannedHeader = scanTomlDottedKey(tableName, headerFailure);
        if (scannedHeader.end !== tableName.length) {
            throw headerFailure();
        }
        headerSegments.push(...scannedHeader.segments);
    }
    const lineFailure = (): Error => new Error(`${path}: unrecognised Cargo manifest line under [${header}]: ${line}`);
    const scannedKey = scanTomlDottedKey(line, lineFailure);
    if (line.charAt(scannedKey.end) !== '=') {
        throw lineFailure();
    }
    return [...headerSegments, ...scannedKey.segments].join('.');
}

function isCargoLicenceGraphKey(keyPath: string): boolean {
    return (
        CARGO_DEPENDENCY_KEY_PATTERN.test(keyPath) ||
        CARGO_FEATURES_KEY_PATTERN.test(keyPath) ||
        CARGO_SOURCE_OVERRIDE_KEY_PATTERN.test(keyPath) ||
        CARGO_WORKSPACE_GRAPH_KEY_PATTERN.test(keyPath) ||
        CARGO_PACKAGE_LICENCE_KEY_PATTERN.test(keyPath) ||
        keyPath === CARGO_PACKAGE_RESOLVER_KEY
    );
}

/**
 * The sorted `[header]`/line pairs of a Cargo manifest that reach the runtime licence graph.
 * Sorting makes key and table order irrelevant, as it is to Cargo.
 */
export function cargoManifestLicenceGraphProjection(text: string, path: string): string {
    // A multi-line string can hold text the line scanner would read as a header or a key.
    if (text.includes('"""') || text.includes("'''")) {
        throw new Error(`${path}: multi-line TOML strings are not supported by the licence input projection`);
    }
    const entries: string[] = [];
    for (const { header, line } of tomlTableLines(text)) {
        const keyPath = cargoKeyPath(header, line, path);
        if (isCargoLicenceGraphKey(keyPath)) {
            entries.push(`[${header.trim()}]\n${line}`);
        } else if (CARGO_DEPENDENCY_SEGMENT_PATTERN.test(keyPath) && !CARGO_METADATA_KEY_PATTERN.test(keyPath)) {
            throw new Error(`${path}: unrecognised dependency table key ${cargoRawKeyPath(header, line)}`);
        }
    }
    return `${entries.sort().join('\n')}\n`;
}

export function packageJsonLicenceFieldsProjection(text: string, path: string): string {
    const manifest = parseJsonWithUniqueKeys<{ license?: JsonValue; scripts?: { build?: JsonValue } }>(text, path);
    return `${canonicalJson({ license: manifest.license ?? null, scripts: { build: manifest.scripts?.build ?? null } })}\n`;
}

export function electronBuilderNodeModulesExclusionProjection(text: string): string {
    return `${text
        .split('\n')
        .filter((line) => ELECTRON_NODE_MODULES_EXCLUSION_PATTERN.test(line))
        .join('\n')}\n`;
}

function projectedBytes(path: string, projection: LicenceInputProjection, bytes: Buffer): Buffer {
    if (projection === 'whole-file') {
        return bytes;
    }
    const text = bytes.toString('utf8');
    if (projection === 'cargo-manifest-licence-graph') {
        return Buffer.from(cargoManifestLicenceGraphProjection(text, path), 'utf8');
    }
    if (projection === 'package-json-licence-fields') {
        return Buffer.from(packageJsonLicenceFieldsProjection(text, path), 'utf8');
    }
    return Buffer.from(electronBuilderNodeModulesExclusionProjection(text), 'utf8');
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
