#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import {
    accessSync,
    constants,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type TrustedGithubWriteCommand =
    | 'deliver'
    | 'issue:reconcile'
    | 'lane:publish'
    | 'review:publish'
    | 'review:publish:recover'
    | 'review:resolve'
    | 'review:resolve:recover';

export const BOOTSTRAP_PATH = 'scripts/trustedGithubWriteBootstrap.ts';
export const HEALTH_GATES_WORKFLOW_PATH = '.github/workflows/health-gates.yml';

export const TRUSTED_PRIMARY_ROOT_ENV = 'SOURDAW_TRUSTED_PRIMARY_ROOT';
export const TRUSTED_COMMON_DIR_ENV = 'SOURDAW_TRUSTED_COMMON_DIR';
export const TRUSTED_GIT_PATH_ENV = 'SOURDAW_TRUSTED_GIT_PATH';
export const TRUSTED_GH_PATH_ENV = 'SOURDAW_TRUSTED_GH_PATH';
export const TRUSTED_PS_PATH_ENV = 'SOURDAW_TRUSTED_PS_PATH';
export const TRUSTED_POWERSHELL_PATH_ENV = 'SOURDAW_TRUSTED_POWERSHELL_PATH';
export const TRUSTED_ORIGIN_COMMIT_ENV = 'SOURDAW_TRUSTED_ORIGIN_COMMIT';
export const TRUSTED_GATE_WORKFLOW_ENV = 'SOURDAW_TRUSTED_GATE_WORKFLOW';

const REVIEW_RESOLUTION_CHILD_ENV = 'SOURDAW_REVIEW_RESOLUTION_CHILD';

export type TrustedLauncherBinding = {
    primaryRoot: string;
    commonDir: string;
    gitPath: string;
    ghPath: string;
    psPath?: string;
    powershellPath?: string;
};

/**
 * What the health-gates workflow says about one job, carried to the gate unresolved. A `name` is
 * whatever the workflow declares — absent, null, a string, or something that is not a name at all —
 * because deciding what a declaration means is the gate's rule to apply, not the launcher's.
 */
export type TrustedWorkflowJob = { name?: unknown; needs?: unknown; uses?: unknown };

export type TrustedGateWorkflow = { jobs: Record<string, TrustedWorkflowJob> } | { unreadable: string };

export type TrustedSourceSnapshot = {
    commit: string;
    sources: ReadonlyMap<string, string>;
    launcher?: TrustedLauncherBinding;
    gateWorkflow?: TrustedGateWorkflow;
};

type TrustedSourcePort = {
    resolveOriginMain: () => string;
    readOriginSource: (commit: string, path: string) => string;
    executeSnapshot: (
        command: TrustedGithubWriteCommand,
        args: string[],
        snapshot: TrustedSourceSnapshot
    ) => Promise<number>;
};

type SnapshotRunner = (
    entryPath: string,
    runner: string,
    args: string[],
    snapshot: TrustedSourceSnapshot,
    command: TrustedGithubWriteCommand
) => Promise<number>;

export function trustedSnapshotRunsDetached(
    command: TrustedGithubWriteCommand,
    platform: NodeJS.Platform = process.platform
): boolean {
    return platform !== 'win32' && (command === 'review:publish' || command === 'review:publish:recover');
}

export function trustedSnapshotSignalTarget(
    pid: number,
    detached: boolean,
    platform: NodeJS.Platform = process.platform
): number {
    return detached && platform !== 'win32' ? -pid : pid;
}

export function forwardTrustedSnapshotSignal(
    pid: number,
    detached: boolean,
    platform: NodeJS.Platform,
    signal: NodeJS.Signals,
    send: (target: number, signal: NodeJS.Signals) => void = (target, forwardedSignal) =>
        process.kill(target, forwardedSignal)
): void {
    try {
        send(trustedSnapshotSignalTarget(pid, detached, platform), signal);
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ESRCH') {
            return;
        }
        throw error;
    }
}

const trustedDependencyGraphs: Record<TrustedGithubWriteCommand, readonly string[]> = {
    deliver: [
        'scripts/trustedGithubWriteBootstrap.ts',
        'scripts/deliverPullRequest.ts',
        'scripts/recoverDeliveryLock.ts',
        'scripts/pullRequestMutationLock.ts',
        'scripts/reconcileTrackerIssue.ts',
        'scripts/trackerIssueReconciliation.ts',
        'scripts/githubAppIdentity.ts',
        'scripts/prContract.ts',
    ],
    'issue:reconcile': [
        'scripts/trustedGithubWriteBootstrap.ts',
        'scripts/reconcileTrackerIssue.ts',
        'scripts/trackerIssueReconciliation.ts',
        'scripts/githubAppIdentity.ts',
        'scripts/prContract.ts',
    ],
    'lane:publish': [
        'scripts/trustedGithubWriteBootstrap.ts',
        'scripts/publishLane.ts',
        'scripts/githubAppIdentity.ts',
        'scripts/prContract.ts',
    ],
    'review:publish': [
        'scripts/trustedGithubWriteBootstrap.ts',
        'scripts/publishReview.ts',
        'scripts/reviewPublicationLegacyIncidents.ts',
        'scripts/prepareReview.ts',
        'scripts/pullRequestMutationLock.ts',
        'scripts/githubAppIdentity.ts',
        'scripts/prContract.ts',
    ],
    'review:publish:recover': [
        'scripts/trustedGithubWriteBootstrap.ts',
        'scripts/publishReview.ts',
        'scripts/reviewPublicationLegacyIncidents.ts',
        'scripts/prepareReview.ts',
        'scripts/pullRequestMutationLock.ts',
        'scripts/githubAppIdentity.ts',
        'scripts/prContract.ts',
    ],
    'review:resolve': [
        'scripts/trustedGithubWriteBootstrap.ts',
        'scripts/resolveReviewThread.ts',
        'scripts/pullRequestMutationLock.ts',
        'scripts/githubAppIdentity.ts',
        'scripts/prContract.ts',
    ],
    'review:resolve:recover': [
        'scripts/trustedGithubWriteBootstrap.ts',
        'scripts/recoverReviewResolutionLock.ts',
        'scripts/resolveReviewThread.ts',
        'scripts/pullRequestMutationLock.ts',
        'scripts/githubAppIdentity.ts',
        'scripts/prContract.ts',
    ],
};

const commandEntries: Record<TrustedGithubWriteCommand, { path: string; runner: string }> = {
    deliver: { path: 'scripts/deliverPullRequest.ts', runner: 'runDeliverCli' },
    'issue:reconcile': { path: 'scripts/reconcileTrackerIssue.ts', runner: 'runReconcileTrackerIssueCli' },
    'lane:publish': { path: 'scripts/publishLane.ts', runner: 'runPublishLaneCli' },
    'review:publish': { path: 'scripts/publishReview.ts', runner: 'runPublishReviewCli' },
    'review:publish:recover': { path: 'scripts/publishReview.ts', runner: 'runRecoverPublishReviewLockCli' },
    'review:resolve': { path: 'scripts/resolveReviewThread.ts', runner: 'runResolveReviewThreadCli' },
    'review:resolve:recover': {
        path: 'scripts/recoverReviewResolutionLock.ts',
        runner: 'runRecoverReviewResolutionLockCli',
    },
};

export function trustedDependencyPaths(command: TrustedGithubWriteCommand): readonly string[] {
    return trustedDependencyGraphs[command];
}

export function assertTrustedSourceGraph(
    command: TrustedGithubWriteCommand,
    sources: ReadonlyMap<string, string>
): void {
    const paths = trustedDependencyPaths(command);
    const pathSet = new Set(paths);
    for (const path of paths) {
        if (!sources.has(path)) {
            throw new Error(`trusted snapshot is missing ${path}`);
        }
    }
    for (const [path, source] of sources) {
        if (!pathSet.has(path)) {
            throw new Error(`trusted snapshot contains unexpected source ${path}`);
        }
        assertSnapshotResolvableImports(path, source, pathSet);
    }
}

/**
 * A bare specifier is the one import shape the snapshot cannot satisfy. It holds nothing but
 * `scripts/`, so Node resolves `node_modules` upward from a temporary directory, finds none, and the
 * command dies mid-delivery with `ERR_MODULE_NOT_FOUND` instead of refusing anything. Only `node:`
 * builtins and the pinned siblings are reachable there, and checking local specifiers alone left
 * that failure invisible until it happened.
 *
 * The loader carries exactly one exemption, named below, and every other source carries none. The
 * loader is the one file the launcher also runs from the protected primary checkout, where the
 * repository's packages do resolve, and it is the one source the snapshot writes and never imports —
 * which the second rule keeps true — so its `yaml` dependency never resolves from a snapshot at all.
 * What holds that parser behind a dynamic call is not this check but the reason it is written that
 * way: a static bare dependency would load for every non-delivery command too, though none reads a
 * workflow or may fail over a package it never uses. The spec pins that shape separately.
 */
function assertSnapshotResolvableImports(path: string, source: string, pathSet: ReadonlySet<string>): void {
    for (const dependency of localModuleDependencies(path, source)) {
        if (!pathSet.has(dependency)) {
            throw new Error(`${path} imports unchecked local dependency ${dependency}`);
        }
        if (dependency === BOOTSTRAP_PATH) {
            throw new Error(`${path} imports ${BOOTSTRAP_PATH}, which the trusted snapshot never executes`);
        }
    }
    for (const specifier of bareModuleSpecifiers(source)) {
        if (path === BOOTSTRAP_PATH && specifier === LOADER_EXEMPT_SPECIFIER) {
            continue;
        }
        throw new Error(`${path} imports ${specifier}, which does not resolve in the trusted snapshot`);
    }
}

/** The whole of the loader's exemption: this one package, in this one file, and nothing else. */
const LOADER_EXEMPT_SPECIFIER = 'yaml';

/**
 * Every shape that names a module: a `from` clause, a side-effect statement that binds nothing, and
 * a dynamic call. Both rules below read the same three, because a list that saw only `from` accepted
 * the other two — and the dynamic call is the shape this loader itself uses, so the bare-specifier
 * rule passed vacuously on the very file it was written to hold.
 *
 * Specifiers are collected by walking syntax, not by regex over raw source. Comments and the contents
 * of string and template literals cannot contribute; only a real `from` / `import` / `import()` form
 * at code depth can. That keeps an example in this comment from being refused as a dependency.
 */
export function snapshotImportSpecifiers(source: string): string[] {
    const specifiers = new Set<string>();
    scanImportSpecifiers(source, 0, source.length, specifiers);
    return [...specifiers];
}

function scanImportSpecifiers(
    source: string,
    start: number,
    end: number,
    specifiers: Set<string>,
    stopAtDepthZero = false
): number {
    let index = start;
    let depth = stopAtDepthZero ? 1 : null;
    while (index < end) {
        const commentEnd = skipComment(source, index);
        if (commentEnd !== undefined) {
            index = commentEnd;
            continue;
        }
        const quote = source[index];
        if (quote === "'" || quote === '"') {
            index = skipQuoted(source, index, quote);
            continue;
        }
        if (quote === '`') {
            index = scanTemplate(source, index, end, specifiers);
            continue;
        }
        const regexEnd = skipRegexLiteral(source, index);
        if (regexEnd !== undefined) {
            index = regexEnd;
            continue;
        }
        if (depth !== null) {
            if (source[index] === '{') {
                depth += 1;
                index += 1;
                continue;
            }
            if (source[index] === '}') {
                depth -= 1;
                if (depth === 0) {
                    return index + 1;
                }
                index += 1;
                continue;
            }
        }
        if (isKeywordAt(source, index, 'from')) {
            const afterKeyword = index + 4;
            const specifier = readModuleStringAfter(source, afterKeyword);
            if (specifier !== undefined) {
                specifiers.add(specifier.value);
                index = specifier.end;
                continue;
            }
        }
        if (isKeywordAt(source, index, 'import')) {
            const afterKeyword = index + 6;
            const sideEffect = readModuleStringAfter(source, afterKeyword);
            if (sideEffect !== undefined) {
                specifiers.add(sideEffect.value);
                index = sideEffect.end;
                continue;
            }
            const dynamic = readDynamicImportSpecifier(source, afterKeyword);
            if (dynamic !== undefined) {
                const before = index === 0 ? undefined : source[index - 1];
                if (before !== '.') {
                    specifiers.add(dynamic.value);
                }
                index = dynamic.end;
                continue;
            }
        }
        index += 1;
    }
    return index;
}

function scanTemplate(source: string, index: number, end: number, specifiers: Set<string>): number {
    let cursor = index + 1;
    while (cursor < end) {
        const character = source[cursor];
        if (character === '\\') {
            cursor += 2;
            continue;
        }
        if (character === '`') {
            return cursor + 1;
        }
        if (character === '$' && source[cursor + 1] === '{') {
            cursor = scanImportSpecifiers(source, cursor + 2, end, specifiers, true);
            continue;
        }
        cursor += 1;
    }
    return end;
}

function isKeywordAt(source: string, index: number, keyword: string): boolean {
    if (!source.startsWith(keyword, index)) {
        return false;
    }
    const before = index === 0 ? undefined : source[index - 1];
    const after = source[index + keyword.length];
    return !isIdentifierContinue(before) && !isIdentifierContinue(after);
}

function isIdentifierContinue(character: string | undefined): boolean {
    return character !== undefined && /[A-Za-z0-9_$]/.test(character);
}

function isLineTerminator(character: string): boolean {
    return character === '\n' || character === '\r' || character === '\u2028' || character === '\u2029';
}

function skipComment(source: string, index: number): number | undefined {
    if (source.startsWith('//', index)) {
        let cursor = index + 2;
        while (cursor < source.length && !isLineTerminator(source[cursor] ?? '')) {
            cursor += 1;
        }
        return cursor < source.length ? cursor + 1 : source.length;
    }
    if (source.startsWith('/*', index)) {
        const end = source.indexOf('*/', index + 2);
        return end === -1 ? source.length : end + 2;
    }
    return undefined;
}

const REGEX_PREFIX_KEYWORDS = new Set([
    'return',
    'throw',
    'case',
    'delete',
    'typeof',
    'void',
    'await',
    'yield',
    'in',
    'of',
    'instanceof',
    'new',
    'extends',
]);

function skipRegexLiteral(source: string, index: number): number | undefined {
    if (source[index] !== '/') {
        return undefined;
    }
    if (!canStartRegexLiteral(source, index)) {
        return undefined;
    }
    let cursor = index + 1;
    let inClass = false;
    while (cursor < source.length) {
        const character = source[cursor];
        if (character === undefined) {
            break;
        }
        if (character === '\\') {
            cursor += 2;
            continue;
        }
        if (inClass) {
            if (character === ']') {
                inClass = false;
            }
            cursor += 1;
            continue;
        }
        if (character === '[') {
            inClass = true;
            cursor += 1;
            continue;
        }
        if (character === '/') {
            cursor += 1;
            while (cursor < source.length && /[a-z]/i.test(source[cursor] ?? '')) {
                cursor += 1;
            }
            return cursor;
        }
        if (isLineTerminator(character)) {
            return undefined;
        }
        cursor += 1;
    }
    return undefined;
}

function canStartRegexLiteral(source: string, index: number): boolean {
    let cursor = index - 1;
    while (cursor >= 0) {
        const character = source[cursor];
        if (character === undefined) {
            break;
        }
        if (isWhiteSpace(character) || isLineTerminator(character)) {
            cursor -= 1;
            continue;
        }
        if (character === '/' && cursor >= 1 && source[cursor - 1] === '*') {
            const open = source.lastIndexOf('/*', cursor - 1);
            if (open === -1) {
                return false;
            }
            cursor = open - 1;
            continue;
        }
        if ('([{;=,.!?:~%^&*+<>|'.includes(character) || character === '-' || character === '}') {
            return true;
        }
        if (character === ')' || character === ']' || character === '"' || character === "'" || character === '`') {
            return false;
        }
        if (isIdentifierContinue(character)) {
            let start = cursor;
            while (start >= 0 && isIdentifierContinue(source[start])) {
                start -= 1;
            }
            const identifier = source.slice(start + 1, cursor + 1);
            return REGEX_PREFIX_KEYWORDS.has(identifier);
        }
        if (character >= '0' && character <= '9') {
            return false;
        }
        return false;
    }
    return true;
}

function skipQuoted(source: string, index: number, quote: "'" | '"'): number {
    let cursor = index + 1;
    while (cursor < source.length) {
        const character = source[cursor];
        if (character === '\\') {
            cursor += 2;
            continue;
        }
        if (character === quote) {
            return cursor + 1;
        }
        cursor += 1;
    }
    return source.length;
}

type ReadSpecifier = { value: string; end: number };

function readModuleStringAfter(source: string, index: number): ReadSpecifier | undefined {
    const start = skipWhitespace(source, index);
    const quote = source[start];
    if (quote === "'" || quote === '"') {
        return readQuotedValue(source, start, quote);
    }
    if (quote === '`') {
        return readStaticTemplateValue(source, start);
    }
    return undefined;
}

function readDynamicImportSpecifier(source: string, index: number): ReadSpecifier | undefined {
    let cursor = skipWhitespace(source, index);
    if (source[cursor] !== '(') {
        return undefined;
    }
    cursor += 1;
    while (true) {
        cursor = skipWhitespace(source, cursor);
        if (source[cursor] !== '(') {
            break;
        }
        cursor += 1;
    }
    return readModuleStringAfter(source, cursor);
}

function readQuotedValue(source: string, index: number, quote: "'" | '"'): ReadSpecifier | undefined {
    let cursor = index + 1;
    let value = '';
    while (cursor < source.length) {
        const character = source[cursor];
        if (character === '\\') {
            if (cursor + 1 >= source.length) {
                return undefined;
            }
            value += source[cursor + 1];
            cursor += 2;
            continue;
        }
        if (character === quote) {
            return { value, end: cursor + 1 };
        }
        if (character === '\n' || character === '\r') {
            return undefined;
        }
        value += character;
        cursor += 1;
    }
    return undefined;
}

function isWhiteSpace(character: string): boolean {
    return (
        character === '\t' ||
        character === '\v' ||
        character === '\f' ||
        character === ' ' ||
        character === '\u00A0' ||
        character === '\uFEFF' ||
        /\p{General_Category=Space_Separator}/u.test(character)
    );
}

function readStaticTemplateValue(source: string, index: number): ReadSpecifier | undefined {
    let cursor = index + 1;
    let value = '';
    while (cursor < source.length) {
        const character = source[cursor];
        if (character === '\\') {
            if (cursor + 1 >= source.length) {
                return undefined;
            }
            value += source[cursor + 1];
            cursor += 2;
            continue;
        }
        if (character === '`') {
            return { value, end: cursor + 1 };
        }
        if (character === '$' && source[cursor + 1] === '{') {
            return undefined;
        }
        value += character;
        cursor += 1;
    }
    return undefined;
}

function skipWhitespace(source: string, index: number): number {
    let cursor = index;
    while (cursor < source.length) {
        const commentEnd = skipComment(source, cursor);
        if (commentEnd !== undefined) {
            cursor = commentEnd;
            continue;
        }
        const character = source[cursor];
        if (character !== undefined && (isWhiteSpace(character) || isLineTerminator(character))) {
            cursor += 1;
            continue;
        }
        break;
    }
    return cursor;
}

export function bareModuleSpecifiers(source: string): string[] {
    return snapshotImportSpecifiers(source).filter(
        (specifier) => !specifier.startsWith('.') && !specifier.startsWith('node:')
    );
}

function localModuleDependencies(path: string, source: string): string[] {
    const dependencies = snapshotImportSpecifiers(source)
        .filter((specifier) => specifier.startsWith('.'))
        .map((specifier) => posix.normalize(posix.join(posix.dirname(path), specifier)));
    return [...new Set(dependencies)];
}

export async function runTrustedGithubWriteCommand(
    command: TrustedGithubWriteCommand,
    args: string[],
    port: TrustedSourcePort
): Promise<number> {
    const commit = port.resolveOriginMain();
    return runTrustedGithubWriteCommandAtCommit(command, args, port, commit);
}

async function runTrustedGithubWriteCommandAtCommit(
    command: TrustedGithubWriteCommand,
    args: string[],
    port: TrustedSourcePort,
    commit: string
): Promise<number> {
    if (commit.trim() === '') {
        throw new Error('origin/main did not resolve to a commit');
    }
    // Every script the command *executes* is read from `origin/main` and run
    // from the snapshot below, so whatever a lane holds for those — mutated, or
    // merely older than main — cannot reach the GitHub write. Refusing on a
    // difference protected none of them any further, and it forced a lane that
    // had only fallen behind to merge main first. A merge can resolve cleanly
    // and leave generated artifacts stale, so that requirement cost real safety
    // to buy none.
    //
    // The package route is accepted only from the protected primary checkout,
    // where this loader is compared with the pinned origin commit before the
    // closure runs. A lane path is command data; no lane package or helper is an
    // executable input to this process.
    const sources = new Map<string, string>();
    for (const path of trustedDependencyPaths(command)) {
        sources.set(path, port.readOriginSource(commit, path));
    }
    assertTrustedSourceGraph(command, sources);
    const gateWorkflow = command === 'deliver' ? await readGateWorkflow(port, commit) : undefined;
    return port.executeSnapshot(command, args, { commit, sources, gateWorkflow });
}

function errorDetail(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * The one dependency this loader takes beyond Node's builtins, and deliberately so: `yaml` is the
 * parser the GitHub-adjacent tooling in this repository already uses, and the launcher runs from the
 * protected primary checkout where it resolves.
 *
 * It is imported here rather than at the top of the file for two reasons. Only `deliver` needs a
 * workflow, so every other command must not fail to start over a package it never reads. And a
 * failure to resolve it arrives as a rejected promise the caller turns into a
 * refusal, where a static import would instead kill the process with `ERR_MODULE_NOT_FOUND` — the
 * merge gate must refuse when it cannot parse the workflow, never crash past the question.
 */
async function parseYaml(source: string): Promise<unknown> {
    const { parse } = await import('yaml');
    return parse(source);
}

/**
 * Only `deliver` reads a workflow, and it reads it at the same pinned commit its own code came from
 * — never the working tree, never a local `HEAD`, either of which would let one unpulled or
 * uncommitted edit reshape the merge gate.
 *
 * An unreadable workflow is carried across as a reason rather than thrown here, so the refusal is
 * worded and owned by the gate. Nothing is resolved or filtered on the way: whatever the workflow
 * declares for a job arrives as it was written.
 */
async function readGateWorkflow(port: TrustedSourcePort, commit: string): Promise<TrustedGateWorkflow> {
    let source: string;
    try {
        source = port.readOriginSource(commit, HEALTH_GATES_WORKFLOW_PATH);
    } catch (error) {
        return { unreadable: `it cannot be read at ${commit}: ${errorDetail(error)}` };
    }
    return summarizeGateWorkflow(source);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The parse the gate cannot perform for itself. A real YAML parser is the point: a line-oriented
 * reader diverges from it on continuation, key spelling, comment separators, block scalars, anchors,
 * aliases, tags and field indentation, and each divergence silently yields a check name GitHub never
 * reports — which matches nothing, and tolerates the cancellation it was meant to catch.
 */
export async function summarizeGateWorkflow(source: string): Promise<TrustedGateWorkflow> {
    let workflow: unknown;
    try {
        workflow = await parseYaml(source);
    } catch (error) {
        return { unreadable: `it is not valid YAML: ${errorDetail(error)}` };
    }
    const jobs = isRecord(workflow) ? workflow.jobs : undefined;
    if (!isRecord(jobs)) {
        return { unreadable: 'it declares no jobs mapping' };
    }
    // A job id is workflow-controlled text, and GitHub accepts `__proto__` as one. Assigning that
    // key on an object literal moves the prototype instead of creating an own property, and
    // `JSON.stringify` then drops the job from the summary entirely — so the gate never sees a job
    // the workflow declares. A prototype-free map has no such key to hit.
    const summary: Record<string, TrustedWorkflowJob> = Object.create(null) as Record<string, TrustedWorkflowJob>;
    for (const [jobId, job] of Object.entries(jobs)) {
        summary[jobId] = isRecord(job) ? { name: carriedName(job.name), needs: job.needs, uses: job.uses } : {};
    }
    return { jobs: summary };
}

/** What a name that is not text crosses as, chosen so no `JSON.stringify` can turn it back into text. */
const NON_TEXT_NAME = { notText: true };

/**
 * The summary crosses to the gate as JSON, which carries less than YAML produces: `Infinity` and
 * `NaN` — what `.inf` and `.nan` parse to — are written as `null`, and a timestamp is written as a
 * quoted string. Either way the gate stops seeing a name that is not text: `null` reads as "declares
 * no name" and answers with the job id, and a quoted timestamp reads as a name GitHub never reports.
 * Both erase the refusal such a declaration is owed, so anything but a string crosses as a value
 * that is not text on either side of the boundary. Deciding what that means stays the gate's rule.
 */
function carriedName(name: unknown): unknown {
    if (name === undefined || name === null || typeof name === 'string') {
        return name;
    }
    return NON_TEXT_NAME;
}

export async function executeTrustedSnapshot(
    command: TrustedGithubWriteCommand,
    args: string[],
    snapshot: TrustedSourceSnapshot,
    runSnapshot: SnapshotRunner = runSnapshotModule
): Promise<number> {
    const snapshotRoot = mkdtempSync(join(tmpdir(), 'sourdaw-trusted-write-'));
    try {
        for (const [path, source] of snapshot.sources) {
            if (!path.startsWith('scripts/') || posix.normalize(path) !== path || path.includes('..')) {
                throw new Error(`invalid trusted snapshot path ${path}`);
            }
            const target = resolve(snapshotRoot, path);
            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(target, source, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
        }
        const entry = commandEntries[command];
        const result = await runSnapshot(resolve(snapshotRoot, entry.path), entry.runner, args, snapshot, command);
        if (!Number.isSafeInteger(result)) {
            throw new TypeError(`trusted ${command} snapshot returned an invalid exit code`);
        }
        return result;
    } finally {
        rmSync(snapshotRoot, { recursive: true, force: true });
    }
}

async function runSnapshotModule(
    entryPath: string,
    runner: string,
    args: string[],
    snapshot: TrustedSourceSnapshot,
    command: TrustedGithubWriteCommand
): Promise<number> {
    const source = [
        "import { pathToFileURL } from 'node:url';",
        'const [entryPath, runner, ...args] = process.argv.slice(2);',
        'const loaded = await import(pathToFileURL(entryPath).href);',
        'const command = Reflect.get(loaded, runner);',
        "if (typeof command !== 'function') throw new Error(`trusted snapshot does not export ${runner}`);",
        'const trustedLauncher = typeof process.env.SOURDAW_TRUSTED_PRIMARY_ROOT === "string" && typeof process.env.SOURDAW_TRUSTED_GIT_PATH === "string" && typeof process.env.SOURDAW_TRUSTED_GH_PATH === "string" ? { primaryRoot: process.env.SOURDAW_TRUSTED_PRIMARY_ROOT, gitPath: process.env.SOURDAW_TRUSTED_GIT_PATH, ghPath: process.env.SOURDAW_TRUSTED_GH_PATH, ...(typeof process.env.SOURDAW_TRUSTED_PS_PATH === "string" ? { psPath: process.env.SOURDAW_TRUSTED_PS_PATH } : {}), ...(typeof process.env.SOURDAW_TRUSTED_POWERSHELL_PATH === "string" ? { powershellPath: process.env.SOURDAW_TRUSTED_POWERSHELL_PATH } : {}) } : undefined;',
        'const dependencies = runner === "runDeliverCli" || runner === "runResolveReviewThreadCli" || runner === "runRecoverReviewResolutionLockCli" ? { trustedLauncher } : undefined;',
        'const result = dependencies === undefined ? await command(args) : await command(args, dependencies);',
        "if (!Number.isSafeInteger(result)) throw new Error('trusted snapshot returned an invalid exit code');",
        'process.exitCode = result;',
    ].join('\n');
    const detached = trustedSnapshotRunsDetached(command);
    const child = spawn(
        process.execPath,
        ['--input-type=module', '--eval', source, 'trusted-snapshot-runner', entryPath, runner, ...args],
        {
            cwd: process.cwd(),
            env: trustedSnapshotEnv(snapshot),
            stdio: 'inherit',
            shell: false,
            detached,
        }
    );
    if (child.pid === undefined) {
        throw new Error('trusted snapshot launcher could not determine the child process');
    }
    const restoreSignalHandlers = detached ? forwardSnapshotSignals(child.pid, process.platform) : () => undefined;
    try {
        const result = await new Promise<{ status: number | null; signal: NodeJS.Signals | null }>(
            (resolve, reject) => {
                child.once('error', reject);
                child.once('close', (status, signal) => resolve({ status, signal }));
            }
        );
        if (result.status === null) {
            throw new Error(`trusted snapshot terminated by ${result.signal ?? 'unknown signal'}`);
        }
        if (result.status !== 0) {
            throw new Error(`trusted snapshot failed with exit ${result.status}`);
        }
        return result.status;
    } finally {
        restoreSignalHandlers();
    }
}

function forwardSnapshotSignals(pid: number, platform: NodeJS.Platform): () => void {
    const forward = (signal: NodeJS.Signals) => forwardTrustedSnapshotSignal(pid, true, platform, signal);
    const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];
    for (const signal of signals) {
        process.on(signal, forward);
    }
    return () => {
        for (const signal of signals) {
            process.off(signal, forward);
        }
    };
}

export function trustedSnapshotEnv(
    snapshot: TrustedSourceSnapshot,
    parent: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
    const env = trustedGitReadEnv(parent);
    for (const key of Object.keys(env)) {
        if (key.toUpperCase() === REVIEW_RESOLUTION_CHILD_ENV) {
            delete env[key];
        }
    }
    if (snapshot.gateWorkflow !== undefined) {
        env[TRUSTED_GATE_WORKFLOW_ENV] = JSON.stringify(snapshot.gateWorkflow);
    }
    const launcher = snapshot.launcher;
    if (launcher === undefined) {
        return env;
    }
    env.PATH = [
        ...new Set([
            dirname(launcher.gitPath),
            dirname(launcher.ghPath),
            ...(launcher.psPath === undefined ? [] : [dirname(launcher.psPath)]),
            ...(launcher.powershellPath === undefined ? [] : [dirname(launcher.powershellPath)]),
            dirname(process.execPath),
        ]),
    ].join(delimiter);
    env[TRUSTED_PRIMARY_ROOT_ENV] = launcher.primaryRoot;
    env[TRUSTED_COMMON_DIR_ENV] = launcher.commonDir;
    env[TRUSTED_GIT_PATH_ENV] = launcher.gitPath;
    env[TRUSTED_GH_PATH_ENV] = launcher.ghPath;
    if (launcher.psPath !== undefined) {
        env[TRUSTED_PS_PATH_ENV] = launcher.psPath;
    }
    if (launcher.powershellPath !== undefined) {
        env[TRUSTED_POWERSHELL_PATH_ENV] = launcher.powershellPath;
    }
    env[TRUSTED_ORIGIN_COMMIT_ENV] = snapshot.commit;
    return env;
}

function captureGit(repositoryRoot: string, gitPath: string, args: string[]): string {
    const result = spawnSync(gitPath, args, {
        cwd: repositoryRoot,
        env: trustedGitReadEnv(),
        encoding: 'utf8',
        shell: false,
    });
    if (result.error !== undefined) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error(result.stderr.trim() || `git failed with exit ${result.status ?? 'signal'}`);
    }
    return result.stdout;
}

// This loader must remain self-contained until it has pinned and validated the source closure, so
// the Git-read environment intentionally duplicates the identity helper's policy instead of
// importing lane-local code before trust is established.
export function trustedGitReadEnv(parent: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...parent };
    for (const key of Object.keys(env)) {
        const normalizedKey = key.toUpperCase();
        if (
            normalizedKey.startsWith('GIT_') ||
            normalizedKey.startsWith('GH_') ||
            normalizedKey.startsWith('GITHUB_') ||
            normalizedKey.startsWith('SOURDAW_GITHUB_APP_') ||
            normalizedKey.startsWith('SOURDAW_TRUSTED_') ||
            normalizedKey.startsWith('NODE_') ||
            normalizedKey === 'SSH_AUTH_SOCK'
        ) {
            delete env[key];
        }
    }
    env.GIT_CONFIG_GLOBAL = '/dev/null';
    env.GIT_CONFIG_SYSTEM = '/dev/null';
    env.GIT_NO_REPLACE_OBJECTS = '1';
    env.GIT_TERMINAL_PROMPT = '0';
    env.GIT_SSH_COMMAND = '/usr/bin/false';
    env.GIT_SSH = '/usr/bin/false';
    env.GCM_INTERACTIVE = 'never';
    return env;
}

export function resolveTrustedExecutable(
    name: 'git' | 'gh' | 'ps',
    parent: NodeJS.ProcessEnv = process.env,
    platform: NodeJS.Platform = process.platform
): string {
    const extensions = platform === 'win32' ? ['.exe'] : [''];
    for (const directory of (parent.PATH ?? '').split(platform === 'win32' ? ';' : delimiter)) {
        for (const extension of extensions) {
            const candidate = resolve(directory || process.cwd(), `${name}${extension.toLowerCase()}`);
            try {
                accessSync(candidate, constants.X_OK);
                return realpathSync(candidate);
            } catch {
                // Try the next operator-provided PATH entry. The protected launcher freezes the
                // first executable it finds before any lane-selected child starts.
            }
        }
    }
    throw new Error(`cannot resolve trusted ${name} executable from the launcher PATH`);
}

function resolveTrustedPowerShellExecutable(
    parent: NodeJS.ProcessEnv = process.env,
    platform: NodeJS.Platform = process.platform
): string {
    const extensions = platform === 'win32' ? ['.exe'] : [''];
    for (const directory of (parent.PATH ?? '').split(platform === 'win32' ? ';' : delimiter)) {
        for (const extension of extensions) {
            const suffix = extension === '' ? '' : extension.toLowerCase();
            const candidate = resolve(directory || process.cwd(), `powershell${suffix}`);
            try {
                accessSync(candidate, constants.X_OK);
                return realpathSync(candidate);
            } catch {
                // Try the next operator-provided PATH entry. The protected launcher freezes the
                // first executable it finds before any lane-selected child starts.
            }
        }
    }
    throw new Error('cannot resolve trusted powershell executable from the launcher PATH');
}

function repositoryCommonDir(checkoutRoot: string, gitPath: string): string {
    const value = captureGit(checkoutRoot, gitPath, ['rev-parse', '--git-common-dir']).trim();
    return realpathSync(isAbsolute(value) ? value : resolve(checkoutRoot, value));
}

export function resolveTrustedLauncherBinding(
    launcherRoot: string,
    parent: NodeJS.ProcessEnv = process.env,
    command?: TrustedGithubWriteCommand,
    platform: NodeJS.Platform = process.platform
): TrustedLauncherBinding {
    const root = realpathSync(launcherRoot);
    const gitPath = resolveTrustedExecutable('git', parent, platform);
    const commonDir = repositoryCommonDir(root, gitPath);
    const primaryRoot = realpathSync(dirname(commonDir));
    if (root !== primaryRoot) {
        throw new Error('trusted GitHub writes must be launched from the protected primary checkout');
    }
    return {
        primaryRoot,
        commonDir,
        gitPath,
        ghPath: resolveTrustedExecutable('gh', parent, platform),
        psPath: commandRequiresTrustedPs(command, platform)
            ? resolveTrustedExecutable('ps', parent, platform)
            : undefined,
        powershellPath: commandRequiresTrustedPowerShell(command, platform)
            ? resolveTrustedPowerShellExecutable(parent, platform)
            : undefined,
    };
}

function commandRequiresTrustedPs(command: TrustedGithubWriteCommand | undefined, platform: NodeJS.Platform): boolean {
    return (
        platform !== 'win32' &&
        (command === 'review:publish' ||
            command === 'review:publish:recover' ||
            command === 'review:resolve' ||
            command === 'review:resolve:recover')
    );
}

function commandRequiresTrustedPowerShell(
    command: TrustedGithubWriteCommand | undefined,
    platform: NodeJS.Platform
): boolean {
    return (
        platform === 'win32' &&
        (command === 'review:publish' ||
            command === 'review:publish:recover' ||
            command === 'review:resolve' ||
            command === 'review:resolve:recover')
    );
}

function defaultPort(binding: TrustedLauncherBinding): TrustedSourcePort {
    return {
        resolveOriginMain: () =>
            captureGit(binding.primaryRoot, binding.gitPath, [
                'rev-parse',
                '--verify',
                'refs/remotes/origin/main^{commit}',
            ]).trim(),
        readOriginSource: (commit, path) =>
            captureGit(binding.primaryRoot, binding.gitPath, ['show', `${commit}:${path}`]),
        executeSnapshot: (command, args, snapshot) =>
            executeTrustedSnapshot(command, args, { ...snapshot, launcher: binding }),
    };
}

function parseCommand(value: string | undefined): TrustedGithubWriteCommand {
    if (
        value === 'deliver' ||
        value === 'issue:reconcile' ||
        value === 'lane:publish' ||
        value === 'review:publish' ||
        value === 'review:publish:recover' ||
        value === 'review:resolve' ||
        value === 'review:resolve:recover'
    ) {
        return value;
    }
    throw new Error(
        'usage: trustedGithubWriteBootstrap.ts <deliver|issue:reconcile|lane:publish|review:publish|review:publish:recover|review:resolve|review:resolve:recover> [args...]'
    );
}

async function main(): Promise<number> {
    const executingFile = fileURLToPath(import.meta.url);
    const launcherRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
    const command = parseCommand(process.argv[2]);
    const binding = resolveTrustedLauncherBinding(launcherRoot, process.env, command);
    const port = defaultPort(binding);
    const commit = port.resolveOriginMain();
    const originBootstrap = port.readOriginSource(commit, BOOTSTRAP_PATH);
    if (readFileSync(executingFile, 'utf8') !== originBootstrap) {
        throw new Error('protected primary launcher does not match its pinned origin/main snapshot');
    }
    return runTrustedGithubWriteCommandAtCommit(command, process.argv.slice(3), port, commit);
}

if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
    void main().then(
        (code) => process.exit(code),
        (error: unknown) => {
            console.error(error instanceof Error ? error.message : error);
            process.exit(1);
        }
    );
}
