import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import ts from 'typescript';

import { offPageSources, selectsBrowserAi } from './e2eAffectedGraph.ts';
import { COVERAGE_MAP_FORMAT, type CoverageMap } from './e2eCoverageMap.ts';
import { isVitestCollected } from './vitestCollectionPatterns.ts';

import type { RuntimeGraph } from './e2eAffectedGraph.ts';

/**
 * Test impact analysis over the nightly coverage map: a pull request whose product edits all
 * sit inside function bodies runs only the browser specs that executed those files. Every
 * condition this cannot prove keeps today's full browser suite.
 */

const SMOKE_SPEC = 'tests/e2e/smoke.spec.ts';
const MAP_LIFETIME_MS = 3 * 24 * 60 * 60 * 1000;
// Runner clocks may trail the artifact's server-side timestamp slightly.
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const BLOB = /^[0-9a-f]{40}$/;

export type PathSelection = { path: string; specs: string[]; browserAi: boolean; reason: string };

export type CoverageSelection = { kind: 'full'; reason: string } | { kind: 'specs'; paths: PathSelection[] };

export type ChangedProductPath = { path: string; status: string };

export type MapAvailability = { kind: 'map'; map: CoverageMap } | { kind: 'unavailable'; reason: string };

/** What the off-page analysis knows: every source in the runtime graph and those a worker or worklet loads. */
export type RuntimeView = { kind: 'graph'; sources: ReadonlySet<string>; offPage: ReadonlySet<string> };

export type CoverageSources = {
    /** The path's blob at the merge-base, or null when it is absent there. */
    baseBlob: (path: string) => string | null;
    /** The path's blob at the map commit: null when absent there, undefined when the commit is unavailable. */
    mapCommitBlob: (path: string) => string | null | undefined;
    baseText: (path: string) => string;
    headText: (path: string) => string;
};

export type CoverageSelectionInput = {
    changes: readonly ChangedProductPath[];
    map: MapAvailability;
    runtime: RuntimeView | { kind: 'full'; reason: string };
    availableSpecs: readonly string[];
    sources: CoverageSources;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isUniqueStringList(value: unknown): value is string[] {
    return (
        Array.isArray(value) &&
        value.every((entry) => typeof entry === 'string' && entry.length > 0) &&
        new Set(value).size === value.length
    );
}

function isSpecIndexList(value: unknown, specCount: number): value is number[] {
    return (
        Array.isArray(value) &&
        value.every((index) => Number.isInteger(index) && index >= 0 && index < specCount) &&
        new Set(value).size === value.length
    );
}

/** Parse an `e2e-coverage-map-v1` document, refusing anything the planner could misread. */
export function parseCoverageMap(text: string): CoverageMap {
    const value: unknown = JSON.parse(text);
    if (!isRecord(value) || value.format !== COVERAGE_MAP_FORMAT) {
        throw new Error(`not an ${COVERAGE_MAP_FORMAT} document`);
    }
    const { commit, specs, alwaysSelect, files } = value;
    if (typeof commit !== 'string' || !BLOB.test(commit)) {
        throw new Error('coverage map commit is not a full SHA');
    }
    if (!isUniqueStringList(specs) || specs.length === 0) {
        throw new Error('coverage map spec inventory is invalid');
    }
    if (!isUniqueStringList(alwaysSelect) || alwaysSelect.some((spec) => !specs.includes(spec))) {
        throw new Error('coverage map alwaysSelect is invalid');
    }
    if (!isRecord(files)) {
        throw new Error('coverage map files are invalid');
    }
    const parsedFiles: CoverageMap['files'] = {};
    for (const [path, entry] of Object.entries(files)) {
        if (
            !path.startsWith('src/') ||
            !isRecord(entry) ||
            typeof entry.blob !== 'string' ||
            !BLOB.test(entry.blob) ||
            !isSpecIndexList(entry.specs, specs.length)
        ) {
            throw new Error(`coverage map entry is invalid: ${path}`);
        }
        parsedFiles[path] = { blob: entry.blob, specs: entry.specs };
    }
    return { format: COVERAGE_MAP_FORMAT, commit, specs, alwaysSelect, files: parsedFiles };
}

/** The map the planner may use: present, well formed, and built within the last three days. */
export function coverageMapFrom(text: string | undefined, createdAt: string | undefined, now: Date): MapAvailability {
    if (text === undefined) {
        return { kind: 'unavailable', reason: 'no coverage map was retrieved' };
    }
    const created = Date.parse(createdAt ?? '');
    if (Number.isNaN(created)) {
        return { kind: 'unavailable', reason: 'coverage map age is unknown' };
    }
    const age = now.getTime() - created;
    if (age > MAP_LIFETIME_MS) {
        return { kind: 'unavailable', reason: 'coverage map is older than three days' };
    }
    if (age < -CLOCK_SKEW_MS) {
        return { kind: 'unavailable', reason: 'coverage map is dated in the future' };
    }
    try {
        return { kind: 'map', map: parseCoverageMap(text) };
    } catch (error) {
        return {
            kind: 'unavailable',
            reason: `coverage map is unreadable: ${error instanceof Error ? error.message : 'invalid JSON'}`,
        };
    }
}

// A leaf token, the entry to or exit from a syntax node, or a collapsed function body.
type Token = { role: 'leaf' | 'enter' | 'exit' | 'body'; kind: ts.SyntaxKind; text: string; pos: number };

/**
 * One side's runtime parse tree flattened in pre-order, and the same stream with each function
 * body collapsed to one placeholder.
 */
type TokenStreams = { full: readonly Token[]; outside: readonly Token[] };

function isFunctionWithBody(node: ts.Node): node is ts.FunctionLikeDeclaration & { body: ts.ConciseBody } {
    return (
        (ts.isFunctionDeclaration(node) ||
            ts.isFunctionExpression(node) ||
            ts.isArrowFunction(node) ||
            ts.isMethodDeclaration(node) ||
            ts.isConstructorDeclaration(node) ||
            ts.isGetAccessorDeclaration(node) ||
            ts.isSetAccessorDeclaration(node)) &&
        node.body !== undefined
    );
}

function hasDeclareModifier(node: ts.Node): boolean {
    return (
        ts.canHaveModifiers(node) &&
        (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword)
    );
}

// Enums emit runtime objects, ambient or not, so they never count as type-only.
function isTypeOnlyDeclaration(node: ts.Node): boolean {
    if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
        return true;
    }
    if (ts.isImportDeclaration(node)) {
        return node.importClause?.isTypeOnly === true;
    }
    if (ts.isExportDeclaration(node) || ts.isImportEqualsDeclaration(node)) {
        return node.isTypeOnly;
    }
    return ts.isStatement(node) && !ts.isEnumDeclaration(node) && hasDeclareModifier(node);
}

// JSDoc nodes are comments the parser attaches to declarations; they never execute.
function isJsDoc(node: ts.Node): boolean {
    return node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode;
}

function syntaxErrorsIn(path: string, text: string): number {
    const output = ts.transpileModule(text, {
        fileName: path,
        reportDiagnostics: true,
        compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.Latest },
    });
    return output.diagnostics?.length ?? 0;
}

// Leaf tokens keep their exact source text, so string and template contents count while
// comments and whitespace, which are trivia between tokens, do not. Node entry and exit markers
// make the comparison structural: a line break that automatic semicolon insertion turns into a
// different parse changes the tree even when the leaves stay the same.
function tokenStreams(path: string, text: string): TokenStreams {
    if (text.includes('\0')) {
        throw new Error('is binary');
    }
    if (syntaxErrorsIn(path, text) > 0) {
        throw new Error('does not parse');
    }
    const kind = path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
    const full: Token[] = [];
    const outside: Token[] = [];
    const emit = (token: Token, isOutside: boolean): void => {
        full.push(token);
        if (isOutside) {
            outside.push(token);
        }
    };
    const visit = (node: ts.Node, isOutside: boolean): void => {
        const children = node.getChildren(source);
        const pos = node.getStart(source);
        if (children.length === 0) {
            emit({ role: 'leaf', kind: node.kind, text: node.getText(source), pos }, isOutside);
            return;
        }
        emit({ role: 'enter', kind: node.kind, text: '', pos }, isOutside);
        for (const child of children) {
            if (isJsDoc(child) || isTypeOnlyDeclaration(child) || child.kind === ts.SyntaxKind.EndOfFileToken) {
                continue;
            }
            const isBody = isFunctionWithBody(node) && child === node.body;
            if (isBody && isOutside) {
                outside.push({ role: 'body', kind: child.kind, text: '', pos: child.getStart(source) });
            }
            visit(child, isOutside && !isBody);
        }
        emit({ role: 'exit', kind: node.kind, text: '', pos: node.end }, isOutside);
    };
    visit(source, true);
    return { full, outside };
}

function sameToken(left: Token | undefined, right: Token | undefined): boolean {
    return (
        left !== undefined &&
        right !== undefined &&
        left.role === right.role &&
        left.kind === right.kind &&
        left.text === right.text
    );
}

// esbuild and TypeScript read these comment pragmas per file, so comments carrying them are not
// trivia. Matching anywhere in the text, case-insensitively, can only over-match.
const JSX_PRAGMA = /@jsx\w*(?:[^\S\r\n]+\S+)?/gi;

type Pragma = { text: string; pos: number };

function jsxPragmas(text: string): Pragma[] {
    return Array.from(text.matchAll(JSX_PRAGMA), (match) => ({ text: match[0], pos: match.index }));
}

// Counted as git counts lines, so lone CR, U+2028 and U+2029 never shift the report.
function lineOf(text: string, position: number): number {
    return text.slice(0, position).split('\n').length;
}

function pragmaDifference(baseText: string, headText: string): string | null {
    const base = jsxPragmas(baseText);
    const head = jsxPragmas(headText);
    const length = Math.max(base.length, head.length);
    for (let index = 0; index < length; index += 1) {
        if (base[index]?.text !== head[index]?.text) {
            const pragma = head[index];
            return `head line ${pragma === undefined ? 1 : lineOf(headText, pragma.pos)}`;
        }
    }
    return null;
}

function firstDifference(base: readonly Token[], head: readonly Token[]): number {
    const length = Math.max(base.length, head.length);
    for (let index = 0; index < length; index += 1) {
        if (!sameToken(base[index], head[index])) {
            return index;
        }
    }
    return -1;
}

type FileVerdict = { kind: 'body' | 'inert' } | { kind: 'outside'; where: string };

/**
 * Compares the runtime parse trees and JSX pragmas of both sides directly. Equal streams are
 * inert; streams that differ only inside function bodies are a body change; anything else is
 * outside, located at the head side's first differing token or pragma for diagnosis.
 */
export function classifyChange(path: string, baseText: string, headText: string): FileVerdict {
    const base = tokenStreams(path, baseText);
    const head = tokenStreams(path, headText);
    const pragmaAt = pragmaDifference(baseText, headText);
    if (pragmaAt !== null) {
        return { kind: 'outside', where: pragmaAt };
    }
    const outsideAt = firstDifference(base.outside, head.outside);
    if (outsideAt >= 0) {
        const position = head.outside[outsideAt]?.pos ?? headText.length;
        return { kind: 'outside', where: `head line ${lineOf(headText, position)}` };
    }
    return firstDifference(base.full, head.full) >= 0 ? { kind: 'body' } : { kind: 'inert' };
}

const HISTORICAL = /^(?:D|T|R\d+|C\d+)$/;

function isNarrowableSource(path: string): boolean {
    return /^src\/.+\.tsx?$/.test(path) && !path.endsWith('.d.ts') && !isVitestCollected(path);
}

/** The rules that need neither the runtime graph nor file contents. */
export function coveragePrecheck(
    changes: readonly ChangedProductPath[],
    map: MapAvailability
): { kind: 'full'; reason: string } | null {
    if (map.kind === 'unavailable') {
        return { kind: 'full', reason: map.reason };
    }
    if (changes.length === 0) {
        return { kind: 'full', reason: 'no product path to select for' };
    }
    const historical = changes.find((change) => HISTORICAL.test(change.status));
    if (historical !== undefined) {
        return { kind: 'full', reason: `${historical.path}: deleted, renamed, copied, or retyped` };
    }
    const unsupported = changes.find((change) => !isNarrowableSource(change.path));
    if (unsupported !== undefined) {
        return { kind: 'full', reason: `${unsupported.path}: not a TypeScript source under src/` };
    }
    return null;
}

function staleness(path: string, map: CoverageMap, sources: CoverageSources): string | null {
    const baseBlob = sources.baseBlob(path);
    if (baseBlob === null) {
        return `${path}: new since the merge-base`;
    }
    const entry = map.files[path];
    if (entry !== undefined) {
        return entry.blob === baseBlob ? null : `${path}: changed since the coverage map commit`;
    }
    const mapBlob = sources.mapCommitBlob(path);
    if (mapBlob === undefined) {
        return `${path}: absent from the coverage map and its commit is unavailable`;
    }
    return mapBlob === baseBlob ? null : `${path}: absent from the coverage map and changed since its commit`;
}

function changeVerdict(path: string, sources: CoverageSources): FileVerdict | string {
    try {
        return classifyChange(path, sources.baseText(path), sources.headText(path));
    } catch (error) {
        return `${path}: ${error instanceof Error ? error.message : 'cannot be classified'}`;
    }
}

function extraSpecs(map: CoverageMap, available: ReadonlySet<string>): string[] {
    const mapped = new Set(map.specs);
    const unmapped = Array.from(available).filter((spec) => !mapped.has(spec));
    const alwaysSelected = map.alwaysSelect.filter((spec) => available.has(spec));
    return Array.from(new Set([...alwaysSelected, ...unmapped]));
}

function describeSelection(verdict: FileVerdict['kind'], fileSpecs: number, extras: number, commit: string): string {
    const subject =
        verdict === 'body'
            ? `function-body change executed by ${fileSpecs} mapped specs`
            : 'type-only or comment change; no mapped spec';
    return `coverage map ${commit.slice(0, 12)}: ${subject}, plus ${extras} always-selected or unmapped specs`;
}

/** Specs a fully narrowable change needs, or the first rule that keeps the full suite. */
export function selectCoverageSpecs(input: CoverageSelectionInput): CoverageSelection {
    const precheck = coveragePrecheck(input.changes, input.map);
    if (precheck !== null || input.map.kind !== 'map') {
        return precheck ?? { kind: 'full', reason: 'coverage map unavailable' };
    }
    if (input.runtime.kind === 'full') {
        return { kind: 'full', reason: `runtime graph unavailable: ${input.runtime.reason}` };
    }
    const { map } = input.map;
    const available = new Set(input.availableSpecs.filter((spec) => spec !== SMOKE_SPEC));
    const extras = extraSpecs(map, available);
    const paths: PathSelection[] = [];
    for (const { path } of input.changes) {
        if (!input.runtime.sources.has(path)) {
            return { kind: 'full', reason: `${path}: absent from the runtime graph` };
        }
        if (input.runtime.offPage.has(path)) {
            return {
                kind: 'full',
                reason: `${path}: loaded by a worker or audio worklet, which page coverage cannot see`,
            };
        }
        const stale = staleness(path, map, input.sources);
        if (stale !== null) {
            return { kind: 'full', reason: stale };
        }
        const verdict = changeVerdict(path, input.sources);
        if (typeof verdict === 'string') {
            return { kind: 'full', reason: verdict };
        }
        if (verdict.kind === 'outside') {
            return { kind: 'full', reason: `${path}: change outside a function body at ${verdict.where}` };
        }
        const fileSpecs =
            verdict.kind === 'body' ? (map.files[path]?.specs ?? []).map((index) => map.specs[index]!) : [];
        const specs = [...new Set([...fileSpecs.filter((spec) => available.has(spec)), ...extras])].sort();
        paths.push({
            path,
            specs,
            browserAi: selectsBrowserAi(specs),
            reason: describeSelection(verdict.kind, fileSpecs.length, extras.length, map.commit),
        });
    }
    return { kind: 'specs', paths };
}

function git(root: string, args: string[]): string {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function blobAt(root: string, revision: string, path: string): string | null {
    try {
        const blob = git(root, ['rev-parse', '--verify', '--quiet', `${revision}:${path}`]).trim();
        return BLOB.test(blob) ? blob : null;
    } catch {
        return null;
    }
}

function commitAvailable(root: string, commit: string): boolean {
    try {
        git(root, ['cat-file', '-e', `${commit}^{commit}`]);
        return true;
    } catch {
        return false;
    }
}

export function gitCoverageSources(root: string, base: string, head: string, mapCommit: string): CoverageSources {
    const mapCommitPresent = commitAvailable(root, mapCommit);
    return {
        baseBlob: (path) => blobAt(root, base, path),
        mapCommitBlob: (path) => (mapCommitPresent ? blobAt(root, mapCommit, path) : undefined),
        baseText: (path) => git(root, ['cat-file', 'blob', `${base}:${path}`]),
        headText: (path) => git(root, ['cat-file', 'blob', `${head}:${path}`]),
    };
}

function readMapText(path: string | undefined): string | undefined {
    if (!path) {
        return undefined;
    }
    try {
        return readFileSync(path, 'utf8');
    } catch {
        return undefined;
    }
}

function runtimeView(runtime: RuntimeGraph | { kind: 'full'; reason: string }): CoverageSelectionInput['runtime'] {
    if (runtime.kind === 'full') {
        return runtime;
    }
    try {
        return {
            kind: 'graph',
            sources: new Set(runtime.graph.map((module) => module.source)),
            offPage: offPageSources(runtime),
        };
    } catch (error) {
        return { kind: 'full', reason: error instanceof Error ? error.message : 'off-page sources unproven' };
    }
}

/** Thin I/O around `selectCoverageSpecs`: the map file, Git contents, and the shared runtime graph. */
export async function loadCoverageSelection(input: {
    root: string;
    base: string;
    head: string;
    changes: readonly ChangedProductPath[];
    availableSpecs: readonly string[];
    map: { path: string | undefined; createdAt: string | undefined };
    now: Date;
    loadRuntime: () => Promise<RuntimeGraph | { kind: 'full'; reason: string }>;
}): Promise<CoverageSelection> {
    const map = coverageMapFrom(readMapText(input.map.path), input.map.createdAt, input.now);
    const precheck = coveragePrecheck(input.changes, map);
    if (precheck !== null || map.kind !== 'map') {
        return precheck ?? { kind: 'full', reason: 'coverage map unavailable' };
    }
    const mergeBase = git(input.root, ['merge-base', input.base, input.head]).trim();
    return selectCoverageSpecs({
        changes: input.changes,
        map,
        runtime: runtimeView(await input.loadRuntime()),
        availableSpecs: input.availableSpecs,
        sources: gitCoverageSources(input.root, mergeBase, input.head, map.map.commit),
    });
}
