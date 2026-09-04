/**
 * Canonical TOML line-scanning for the parts of a Cargo workspace manifest
 * that actually reach a compiled wasm cdylib.
 *
 * #3473: `hashCrateClosure` (`wasm-artifacts.ts`) used to hash the raw bytes
 * of the workspace-root `Cargo.toml`, so an edit anywhere in it — a new
 * `[workspace].members` entry, a comment, reflowed whitespace — moved every
 * wasm package's recorded hash for no byte change in any cdylib.
 * `workspaceManifestFingerprintInput` renders only the root manifest's
 * `[profile*]` tables, its `[workspace.package]` table, any `[patch*]` or
 * `[replace]` table (they redirect dependency sources), the `resolver` line
 * under `[workspace]` (it changes feature unification), and the
 * `[workspace.dependencies]` entries — flat or as a `[workspace.dependencies.
 * <name>]` sub-table — a crate's path-dependency closure actually resolves
 * (found via `workspaceDependencyNames` over each closure crate's own
 * `Cargo.toml`). `[workspace].members`, comments, `[workspace.lints*]`, and
 * `[workspace.metadata]` are not part of the rendering — they never affect
 * the compiled bytes.
 *
 * No TOML dependency is installed for the repository, so this is a
 * deliberately narrow, line-oriented scanner over the manifest shapes it has
 * to cover — not a general TOML parser. It fails closed: a dependency-table
 * entry `workspaceDependencyNames` cannot classify throws rather than
 * silently shrinking the used-dependency set (a shrunk set drops a
 * `[workspace.dependencies]` entry the crate actually resolves out of the
 * fingerprint, exactly the class of bug this module exists to prevent).
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

/** Net change in unquoted `{}`/`[]` nesting depth contributed by `line`. */
function tomlBracketDepthDelta(line: string): number {
    let delta = 0;
    let quoteChar: string | undefined;
    for (const char of line) {
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
        if (char === '{' || char === '[') {
            delta += 1;
        } else if (char === '}' || char === ']') {
            delta -= 1;
        }
    }
    return delta;
}

/** A TOML table-header line, e.g. `[profile.release]` or `[[bin]]`. */
const tomlTableHeaderPattern = /^\s*\[(.+)\]\s*$/;

/** The first capture group of a match, guarded against a pattern edited to drop it. */
function requiredCapture(match: RegExpMatchArray, subject: string): string {
    const captured = match[1];
    if (captured === undefined) {
        throw new Error(`Pattern for ${subject} matched without its capture group`);
    }
    return captured;
}

/** Trim and strip one layer of surrounding quotes from a TOML key or bare header segment. */
function unquoteTomlKey(value: string): string {
    return value.trim().replaceAll(/^["']|["']$/g, '');
}

/** One logical TOML content line (never a header line) paired with its enclosing table header. */
export type TomlTableLine = { header: string; line: string };

/**
 * Walk `text` into stripped, non-blank, comment-free content lines paired
 * with their current table header. An inline table or array whose `{}`/`[]`
 * nesting spans several source lines (e.g. `crates/daw-engine/Cargo.toml`'s
 * `windows = { workspace = true, features = [ ... ] }`) is accumulated into
 * one logical line — trimmed and space-joined — so a caller never sees a
 * fragment of a multi-line entry.
 */
export function* tomlTableLines(text: string): Generator<TomlTableLine> {
    let currentHeader = '';
    let pendingLine: string | undefined;
    let pendingDepth = 0;

    for (const rawLine of text.split('\n')) {
        const stripped = stripTomlCommentAndTrailingWhitespace(rawLine);
        if (pendingLine !== undefined) {
            if (stripped.trim() === '') {
                continue;
            }
            pendingLine += ` ${stripped.trim()}`;
            pendingDepth += tomlBracketDepthDelta(stripped);
            if (pendingDepth <= 0) {
                yield { header: currentHeader, line: pendingLine };
                pendingLine = undefined;
                pendingDepth = 0;
            }
            continue;
        }
        if (stripped.trim() === '') {
            continue;
        }
        const headerMatch = tomlTableHeaderPattern.exec(stripped);
        if (headerMatch !== null) {
            currentHeader = requiredCapture(headerMatch, 'a table header in a TOML manifest');
            continue;
        }
        const depth = tomlBracketDepthDelta(stripped);
        if (depth > 0) {
            pendingLine = stripped.trim();
            pendingDepth = depth;
            continue;
        }
        yield { header: currentHeader, line: stripped };
    }
}

/** The key of a `key = value` TOML line, trimmed and unquoted. */
function tomlLineKey(line: string): string {
    const equalsIndex = line.indexOf('=');
    return unquoteTomlKey(equalsIndex === -1 ? line : line.slice(0, equalsIndex));
}

/** A `[workspace.dependencies.<name>]` sub-table header, unquoted — or `undefined` for any other header. */
const workspaceDependencySubTablePattern = /^workspace\.dependencies\.(.+)$/;

function workspaceDependencySubTableName(header: string): string | undefined {
    const match = workspaceDependencySubTablePattern.exec(header);
    return match === null
        ? undefined
        : unquoteTomlKey(requiredCapture(match, 'a workspace.dependencies sub-table header'));
}

/**
 * Whether a stripped, non-blank manifest line under `header` reaches the
 * compiled cdylib and belongs in the canonical fingerprint rendering:
 *  - any `[profile*]` table (opt-level, lto, per-package overrides, …);
 *  - the whole `[workspace.package]` table (inherited into closure crates
 *    via `*.workspace = true`);
 *  - a `[workspace.dependencies]` entry, flat or as its own
 *    `[workspace.dependencies.<name>]` sub-table, the closure resolves;
 *  - any `[patch]`/`[patch.*]` or `[replace]` table (they redirect where a
 *    dependency's source comes from);
 *  - the `resolver` line under `[workspace]` (it changes feature
 *    unification).
 * `[workspace.lints*]` (diagnostics only) and `[workspace.metadata]` are
 * deliberately excluded, along with everything else under `[workspace]`
 * (`members`, comments, …) and the workspace dependencies the closure never
 * resolves.
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
    const dependencySubTableName = workspaceDependencySubTableName(header);
    if (dependencySubTableName !== undefined) {
        return usedWorkspaceDependencies.has(dependencySubTableName);
    }
    if (header === 'patch' || header.startsWith('patch.')) {
        return true;
    }
    if (header === 'replace' || header.startsWith('replace.')) {
        return true;
    }
    if (header === 'workspace' && tomlLineKey(line) === 'resolver') {
        return true;
    }
    return false;
}

/**
 * Canonical rendering of the root `Cargo.toml` inputs that reach a wasm
 * crate's compiled cdylib (see `isFingerprintedWorkspaceManifestLine` for the
 * exact scope). `[workspace].members`, comments, `[workspace.lints*]`,
 * `[workspace.metadata]`, and any workspace dependency the closure never
 * resolves are not part of the rendering, so editing them cannot move
 * `hashCrateClosure`'s output.
 */
export function workspaceManifestFingerprintInput(
    manifestText: string,
    usedWorkspaceDependencies: ReadonlySet<string>
): string {
    let rendered = '';
    for (const { header, line } of tomlTableLines(manifestText)) {
        if (isFingerprintedWorkspaceManifestLine(header, line, usedWorkspaceDependencies)) {
            rendered += `[${header}]\n${line}\n`;
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

/** A quoted string value: `"1.2"` or `'1.2'`. */
const quotedStringValuePattern = /^(?:"(?:[^"\\]|\\.)*"|'[^']*')$/;

type DependencyEntryClassification =
    | { kind: 'plain-version' }
    | { kind: 'inline-table'; name: string; declaresWorkspaceTrue: boolean }
    | { kind: 'dotted-key'; name: string; field: string; value: string };

/**
 * Classify one content line directly under a `dependencies`/`dev-dependencies`/
 * `build-dependencies` table (never a `.name` sub-table body, which is
 * accepted as-is by its caller) as a plain string version, an inline table
 * (with or without `workspace = true`), or a dotted-key field assignment
 * (`name.workspace = true`, `name.features = [...]`, …). Returns `undefined`
 * for a shape none of those cover.
 */
function classifyDependencyEntry(line: string): DependencyEntryClassification | undefined {
    const equalsIndex = line.indexOf('=');
    if (equalsIndex === -1) {
        return undefined;
    }
    const rawKey = line.slice(0, equalsIndex).trim();
    const rawValue = line.slice(equalsIndex + 1).trim();

    const dotIndex = rawKey.indexOf('.');
    if (dotIndex !== -1) {
        return {
            kind: 'dotted-key',
            name: unquoteTomlKey(rawKey.slice(0, dotIndex)),
            field: unquoteTomlKey(rawKey.slice(dotIndex + 1)),
            value: rawValue,
        };
    }

    if (rawValue.startsWith('{') && rawValue.endsWith('}')) {
        return {
            kind: 'inline-table',
            name: unquoteTomlKey(rawKey),
            declaresWorkspaceTrue: workspaceInlineDependencyPattern.test(line),
        };
    }
    if (quotedStringValuePattern.test(rawValue)) {
        return { kind: 'plain-version' };
    }
    return undefined;
}

/**
 * Names of a crate's own dependencies declared with `workspace = true` — the
 * only entries `[workspace.dependencies]` on the root manifest resolves for
 * it. `authors.workspace = true` and friends under `[package]` are table
 * inheritance, not a dependency, and are excluded by construction: they never
 * sit under a `dependencies` table header.
 *
 * Fails closed: an entry directly under a `dependencies` table whose shape is
 * none of plain string version, inline table, or dotted key throws instead of
 * silently being skipped, so an unhandled spelling reddens `wasm:verify`
 * rather than shrinking the used-dependency set it feeds.
 */
export function workspaceDependencyNames(cargoTomlText: string): Set<string> {
    const names = new Set<string>();
    for (const { header, line } of tomlTableLines(cargoTomlText)) {
        const dependencyHeaderMatch = dependencyTableHeaderPattern.exec(header);
        if (dependencyHeaderMatch === null) {
            continue;
        }
        const subTableName = dependencyHeaderMatch[1];
        if (subTableName !== undefined) {
            if (workspaceSubTableFlagPattern.test(line.trim())) {
                names.add(unquoteTomlKey(subTableName));
            }
            continue;
        }
        const classification = classifyDependencyEntry(line);
        if (classification === undefined) {
            throw new Error(`Unrecognised dependency entry in ${header}: ${line}`);
        }
        if (classification.kind === 'inline-table' && classification.declaresWorkspaceTrue) {
            names.add(classification.name);
        }
        if (
            classification.kind === 'dotted-key' &&
            classification.field === 'workspace' &&
            classification.value === 'true'
        ) {
            names.add(classification.name);
        }
    }
    return names;
}
