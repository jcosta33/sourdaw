/**
 * Canonical TOML line-scanning for the parts of a Cargo workspace manifest
 * that actually reach a compiled wasm cdylib.
 *
 * #3473: `hashCrateClosure` (`wasm-artifacts.ts`) used to hash the raw bytes
 * of the workspace-root `Cargo.toml`, so an edit anywhere in it — a new
 * `[workspace].members` entry, a comment, reflowed whitespace — moved every
 * wasm package's recorded hash for no byte change in any cdylib.
 * `workspaceManifestFingerprintInput` renders only the root manifest's
 * profile tables, its workspace package table, and the workspace dependency
 * entries a crate's path-dependency closure actually resolves (found via
 * `workspaceDependencyNames` over each closure crate's own `Cargo.toml`);
 * `[workspace].members`, `resolver`, comments, and unused workspace
 * dependencies are not part of the rendering.
 *
 * No TOML dependency is installed for the repository, so this is a
 * deliberately narrow, line-oriented scanner over the two manifest shapes it
 * has to cover — not a general TOML parser.
 */

/** Strip a TOML `#` comment (only outside a quoted string) and trailing whitespace. */
function stripTomlCommentAndTrailingWhitespace(line: string): string {
    let quoteChar: string | undefined;
    for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        if (quoteChar !== undefined) {
            if (char === quoteChar) {
                quoteChar = undefined;
            }
            continue;
        }
        if (char === '"' || char === "'") {
            quoteChar = char;
            continue;
        }
        if (char === '#') {
            return line.slice(0, index).trimEnd();
        }
    }
    return line.trimEnd();
}

/** A TOML table-header line, e.g. `[profile.release]` or `[[bin]]`. */
const tomlTableHeaderPattern = /^\s*\[(.+)\]\s*$/;

/** The first capture group of a table-header match, guarded against a pattern edited to drop it. */
function tomlHeaderCapture(match: RegExpMatchArray, subject: string): string {
    const captured = match[1];
    if (captured === undefined) {
        throw new Error(`Pattern for ${subject} matched without its capture group`);
    }
    return captured;
}

/** The key of a `key = value` TOML line, trimmed and unquoted. */
function tomlLineKey(line: string): string {
    const equalsIndex = line.indexOf('=');
    const rawKey = equalsIndex === -1 ? line : line.slice(0, equalsIndex);
    return rawKey.trim().replaceAll(/^["']|["']$/g, '');
}

/**
 * Whether a stripped, non-blank manifest line under `header` reaches the
 * compiled cdylib and belongs in the canonical fingerprint rendering: any
 * `[profile*]` table (opt-level, lto, per-package overrides, …), the whole
 * `[workspace.package]` table (inherited into closure crates via
 * `*.workspace = true`), or a `[workspace.dependencies]` entry the closure
 * actually resolves.
 */
function isFingerprintedWorkspaceManifestLine(
    header: string,
    line: string,
    usedWorkspaceDependencies: ReadonlySet<string>
): boolean {
    if (header === 'profile' || header.startsWith('profile.')) {
        return true;
    }
    if (header === 'workspace.package') {
        return true;
    }
    if (header === 'workspace.dependencies') {
        return usedWorkspaceDependencies.has(tomlLineKey(line));
    }
    return false;
}

/**
 * Canonical rendering of the root `Cargo.toml` inputs that reach a wasm
 * crate's compiled cdylib. `[workspace].members`, `resolver`, comments, and
 * any workspace dependency the closure never resolves are not part of the
 * rendering, so editing them cannot move `hashCrateClosure`'s output.
 */
export function workspaceManifestFingerprintInput(
    manifestText: string,
    usedWorkspaceDependencies: ReadonlySet<string>
): string {
    let currentHeader = '';
    let rendered = '';
    for (const rawLine of manifestText.split('\n')) {
        const stripped = stripTomlCommentAndTrailingWhitespace(rawLine);
        if (stripped.trim() === '') {
            continue;
        }
        const headerMatch = tomlTableHeaderPattern.exec(stripped);
        if (headerMatch !== null) {
            currentHeader = tomlHeaderCapture(headerMatch, 'a table header in the workspace manifest');
            continue;
        }
        if (isFingerprintedWorkspaceManifestLine(currentHeader, stripped, usedWorkspaceDependencies)) {
            rendered += `[${currentHeader}]\n${stripped}\n`;
        }
    }
    return rendered;
}

/** Matches a `dependencies` table header, including `dev-`/`build-`/`target.*.` variants and `.name` sub-tables. */
const dependencyTableHeaderPattern = /(?:^|\.)(?:dependencies|dev-dependencies|build-dependencies)(?:\.(.+))?$/;

/** Whether `line` is a `name = { workspace = true, ... }` inline-table dependency entry. */
const workspaceInlineDependencyPattern = /\{[^}]*\bworkspace\s*=\s*true\b[^}]*\}/;

/** Whether `line` is a bare `workspace = true` assignment inside a `[dependencies.name]` sub-table. */
const workspaceSubTableFlagPattern = /^workspace\s*=\s*true$/;

/**
 * Names of a crate's own dependencies declared with `workspace = true` — the
 * only entries `[workspace.dependencies]` on the root manifest resolves for
 * it. `authors.workspace = true` and friends under `[package]` are table
 * inheritance, not a dependency, and are excluded by construction: they never
 * sit under a `dependencies` table header.
 */
export function workspaceDependencyNames(cargoTomlText: string): Set<string> {
    const names = new Set<string>();
    let currentHeader = '';
    for (const rawLine of cargoTomlText.split('\n')) {
        const stripped = stripTomlCommentAndTrailingWhitespace(rawLine);
        if (stripped.trim() === '') {
            continue;
        }
        const headerMatch = tomlTableHeaderPattern.exec(stripped);
        if (headerMatch !== null) {
            currentHeader = tomlHeaderCapture(headerMatch, 'a table header in a crate manifest');
            continue;
        }
        const dependencyHeaderMatch = dependencyTableHeaderPattern.exec(currentHeader);
        if (dependencyHeaderMatch === null) {
            continue;
        }
        const subTableName = dependencyHeaderMatch[1];
        if (subTableName !== undefined) {
            if (workspaceSubTableFlagPattern.test(stripped.trim())) {
                names.add(subTableName.trim().replaceAll(/^["']|["']$/g, ''));
            }
            continue;
        }
        if (workspaceInlineDependencyPattern.test(stripped)) {
            names.add(tomlLineKey(stripped));
        }
    }
    return names;
}
