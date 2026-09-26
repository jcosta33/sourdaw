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

import {
    TRUSTED_COMMON_DIR_ENV,
    TRUSTED_GATE_WORKFLOW_ENV,
    TRUSTED_GH_PATH_ENV,
    TRUSTED_GIT_PATH_ENV,
    TRUSTED_ORIGIN_COMMIT_ENV,
    TRUSTED_POWERSHELL_PATH_ENV,
    TRUSTED_PRIMARY_ROOT_ENV,
    TRUSTED_PS_PATH_ENV,
    TRUSTED_GIT_AI_PATH_ENV,
} from './prContract.ts';

export type TrustedGithubWriteCommand =
    | 'deliver'
    | 'issue:claim'
    | 'issue:reconcile'
    | 'lane:publish'
    | 'lane:sync-parent'
    | 'review:accept'
    | 'review:publish'
    | 'review:publish:recover'
    | 'review:repair'
    | 'review:confirm'
    | 'review:resolve'
    | 'review:shadow-status'
    | 'ruleset:harden';

export const BOOTSTRAP_PATH = 'scripts/trustedGithubWriteBootstrap.ts';
export const HEALTH_GATES_WORKFLOW_PATH = '.github/workflows/health-gates.yml';

export type TrustedLauncherBinding = {
    primaryRoot: string;
    commonDir: string;
    gitPath: string;
    ghPath: string;
    psPath?: string;
    powershellPath?: string;
    gitAiPath?: string;
};

/**
 * What the health-gates workflow says about one job, carried to the gate unresolved. A `name` is
 * whatever the workflow declares — absent, null, a string, or something that is not a name at all —
 * because deciding what a declaration means is the gate's rule to apply, not the launcher's.
 * `strategy` crosses for the same reason: a matrix name inside a called workflow is only derivable
 * from the matrix values the workflow declares, and substituting them is the gate's rule too.
 */
export type TrustedWorkflowJob = { name?: unknown; needs?: unknown; uses?: unknown; strategy?: unknown };

/**
 * A workflow a gated job calls, read at the same pinned commit and carried the same way: its declared
 * `name` and its jobs, unresolved. GitHub reports a called workflow's jobs as one check per inner job
 * named `<caller job name> / <inner job name>`, so the gate cannot derive the gating set without it.
 */
export type TrustedCalledWorkflow =
    { name?: unknown; jobs: Record<string, TrustedWorkflowJob> } | { unreadable: string };

export type TrustedGateWorkflow =
    | { jobs: Record<string, TrustedWorkflowJob>; called: Record<string, TrustedCalledWorkflow> }
    | { unreadable: string };

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

/**
 * These commands fence their lock owner on the process identity that holds it, so the launcher must
 * put the whole command tree in one process group: a surviving child is then what keeps the fence
 * live, and recovery can prove the crashed owner gone.
 */
function commandFencesItsLockOwner(command: TrustedGithubWriteCommand | undefined): boolean {
    return (
        command === 'deliver' ||
        command === 'review:accept' ||
        command === 'review:publish' ||
        command === 'review:publish:recover'
    );
}

export function trustedSnapshotRunsDetached(
    command: TrustedGithubWriteCommand,
    platform: NodeJS.Platform = process.platform
): boolean {
    return platform !== 'win32' && commandFencesItsLockOwner(command);
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

export const trustedDependencyGraphs: Record<TrustedGithubWriteCommand, readonly string[]> = {
    deliver: [
        'scripts/trustedGithubWriteBootstrap.ts',
        'scripts/deliverPullRequest.ts',
        'scripts/pullRequestReviewState.ts',
        'scripts/recoverDeliveryLock.ts',
        'scripts/deliveryLockLegacyIncidents.ts',
        'scripts/deliveryRemoteInspection.ts',
        'scripts/pullRequestMutationLock.ts',
        'scripts/reconcileTrackerIssue.ts',
        'scripts/trackerIssueReconciliation.ts',
        'scripts/reviewBundleLocator.ts',
        'scripts/reviewDossier.ts',
        'scripts/reviewDossierBindings.ts',
        'scripts/reviewDossierReassessed.ts',
        'scripts/reviewDossierChain.ts',
        'scripts/reviewDossierViews.ts',
        'scripts/evidenceSafety.ts',
        'scripts/canonicalRecord.ts',
        'scripts/reviewRiskPolicy.ts',
        'scripts/reviewDiffSummary.ts',
        'scripts/wasm-artifacts.ts',
        'scripts/wasmToolchainPins.ts',
        'scripts/workspaceManifestFingerprint.ts',
        'scripts/githubAppIdentity.ts',
        'scripts/prContract.ts',
    ],
    'issue:claim': [
        'scripts/trustedGithubWriteBootstrap.ts',
        'scripts/claimTrackerIssue.ts',
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
        'scripts/testInstructions.ts',
        'scripts/stackedLanes.ts',
        'scripts/reviewDiffSummary.ts',
        'scripts/wasm-artifacts.ts',
        'scripts/wasmToolchainPins.ts',
        'scripts/workspaceManifestFingerprint.ts',
    ],
    'lane:sync-parent': [
        'scripts/trustedGithubWriteBootstrap.ts',
        'scripts/syncParentLane.ts',
        'scripts/publishLane.ts',
        'scripts/githubAppIdentity.ts',
        'scripts/prContract.ts',
        'scripts/testInstructions.ts',
        'scripts/stackedLanes.ts',
        'scripts/reviewDiffSummary.ts',
        'scripts/wasm-artifacts.ts',
        'scripts/wasmToolchainPins.ts',
        'scripts/workspaceManifestFingerprint.ts',
    ],
    'review:accept': [
        'scripts/trustedGithubWriteBootstrap.ts',
        'scripts/acceptReview.ts',
        'scripts/reconstructReviewRounds.ts',
        'scripts/reviewRepair.ts',
        'scripts/reviewRoundEscalation.ts',
        'scripts/publishReview.ts',
        'scripts/pullRequestReviewState.ts',
        'scripts/reviewCommentDiffPreflight.ts',
        'scripts/reviewDocumentParser.ts',
        'scripts/reviewDossier.ts',
        'scripts/reviewDossierBindings.ts',
        'scripts/reviewDossierReassessed.ts',
        'scripts/reviewDossierChain.ts',
        'scripts/evidenceSafety.ts',
        'scripts/canonicalRecord.ts',
        'scripts/reviewDossierPublication.ts',
        'scripts/reviewDossierViews.ts',
        'scripts/reviewerModelDiversity.ts',
        'scripts/reviewRiskPolicy.ts',
        'scripts/reviewPublicationRemoteInspection.ts',
        'scripts/reviewPublicationBinding.ts',
        'scripts/reviewDossierSemanticAssessment.ts',
        'scripts/prepareReview.ts',
        'scripts/reviewBundleLocator.ts',
        'scripts/pullRequestMutationLock.ts',
        'scripts/githubAppIdentity.ts',
        'scripts/prContract.ts',
        'scripts/reviewApprovalFormat.ts',
        'scripts/reviewApprovalContext.ts',
        'scripts/stackedLanes.ts',
        'scripts/reviewDiffSummary.ts',
        'scripts/wasm-artifacts.ts',
        'scripts/wasmToolchainPins.ts',
        'scripts/workspaceManifestFingerprint.ts',
    ],
    'review:publish': [
        'scripts/trustedGithubWriteBootstrap.ts',
        'scripts/publishReview.ts',
        'scripts/reconstructReviewRounds.ts',
        'scripts/reviewRepair.ts',
        'scripts/reviewRoundEscalation.ts',
        'scripts/pullRequestReviewState.ts',
        'scripts/reviewCommentDiffPreflight.ts',
        'scripts/reviewDocumentParser.ts',
        'scripts/reviewDossier.ts',
        'scripts/reviewDossierBindings.ts',
        'scripts/reviewDossierReassessed.ts',
        'scripts/reviewDossierChain.ts',
        'scripts/evidenceSafety.ts',
        'scripts/canonicalRecord.ts',
        'scripts/reviewDossierPublication.ts',
        'scripts/reviewDossierViews.ts',
        'scripts/reviewerModelDiversity.ts',
        'scripts/reviewRiskPolicy.ts',
        'scripts/reviewPublicationRemoteInspection.ts',
        'scripts/reviewPublicationBinding.ts',
        'scripts/reviewDossierSemanticAssessment.ts',
        'scripts/prepareReview.ts',
        'scripts/reviewBundleLocator.ts',
        'scripts/pullRequestMutationLock.ts',
        'scripts/githubAppIdentity.ts',
        'scripts/prContract.ts',
        'scripts/reviewApprovalFormat.ts',
        'scripts/reviewApprovalContext.ts',
        'scripts/stackedLanes.ts',
        'scripts/reviewDiffSummary.ts',
        'scripts/wasm-artifacts.ts',
        'scripts/wasmToolchainPins.ts',
        'scripts/workspaceManifestFingerprint.ts',
    ],
    'review:publish:recover': [
        'scripts/trustedGithubWriteBootstrap.ts',
        'scripts/recoverPublishReviewLock.ts',
        'scripts/reconstructReviewRounds.ts',
        'scripts/reviewRepair.ts',
        'scripts/reviewRoundEscalation.ts',
        'scripts/publishReview.ts',
        'scripts/pullRequestReviewState.ts',
        'scripts/reviewCommentDiffPreflight.ts',
        'scripts/reviewDocumentParser.ts',
        'scripts/reviewDossier.ts',
        'scripts/reviewDossierBindings.ts',
        'scripts/reviewDossierReassessed.ts',
        'scripts/reviewDossierChain.ts',
        'scripts/evidenceSafety.ts',
        'scripts/canonicalRecord.ts',
        'scripts/reviewDossierPublication.ts',
        'scripts/reviewDossierViews.ts',
        'scripts/reviewerModelDiversity.ts',
        'scripts/reviewRiskPolicy.ts',
        'scripts/reviewPublicationLegacyIncidents.ts',
        'scripts/reviewPublicationRecoveryReceipt.ts',
        'scripts/reviewPublicationRemoteInspection.ts',
        'scripts/reviewPublicationBinding.ts',
        'scripts/reviewDossierSemanticAssessment.ts',
        'scripts/prepareReview.ts',
        'scripts/reviewBundleLocator.ts',
        'scripts/pullRequestMutationLock.ts',
        'scripts/githubAppIdentity.ts',
        'scripts/prContract.ts',
        'scripts/reviewApprovalFormat.ts',
        'scripts/reviewApprovalContext.ts',
        'scripts/stackedLanes.ts',
        'scripts/reviewDiffSummary.ts',
        'scripts/wasm-artifacts.ts',
        'scripts/wasmToolchainPins.ts',
        'scripts/workspaceManifestFingerprint.ts',
    ],
    'review:repair': [
        'scripts/trustedGithubWriteBootstrap.ts',
        'scripts/repairReviewFinding.ts',
        'scripts/reconstructReviewRounds.ts',
        'scripts/reviewBundleLocator.ts',
        'scripts/reviewDossierViews.ts',
        'scripts/reviewRoundEscalation.ts',
        'scripts/reviewRepair.ts',
        'scripts/reviewDossier.ts',
        'scripts/reviewDossierBindings.ts',
        'scripts/reviewDossierReassessed.ts',
        'scripts/reviewDossierChain.ts',
        'scripts/evidenceSafety.ts',
        'scripts/canonicalRecord.ts',
        'scripts/reviewRiskPolicy.ts',
        'scripts/reviewDiffSummary.ts',
        'scripts/wasm-artifacts.ts',
        'scripts/wasmToolchainPins.ts',
        'scripts/workspaceManifestFingerprint.ts',
        'scripts/githubAppIdentity.ts',
        'scripts/prContract.ts',
    ],
    'review:confirm': [
        'scripts/trustedGithubWriteBootstrap.ts',
        'scripts/confirmReviewRepairs.ts',
        'scripts/reviewRepair.ts',
        'scripts/evidenceSafety.ts',
        'scripts/canonicalRecord.ts',
        'scripts/githubAppIdentity.ts',
        'scripts/prContract.ts',
    ],
    'review:resolve': [
        'scripts/trustedGithubWriteBootstrap.ts',
        'scripts/resolveThread.ts',
        'scripts/githubAppIdentity.ts',
        'scripts/prContract.ts',
    ],
    'review:shadow-status': [
        'scripts/trustedGithubWriteBootstrap.ts',
        'scripts/reviewShadowStatus.ts',
        'scripts/githubAppIdentity.ts',
        'scripts/prContract.ts',
    ],
    'ruleset:harden': [
        'scripts/trustedGithubWriteBootstrap.ts',
        'scripts/rulesetHardening.ts',
        'scripts/canonicalRecord.ts',
        'scripts/githubAppIdentity.ts',
        'scripts/prContract.ts',
    ],
};

export const commandEntries: Record<TrustedGithubWriteCommand, { path: string; runner: string }> = {
    deliver: { path: 'scripts/deliverPullRequest.ts', runner: 'runDeliverCli' },
    'issue:claim': { path: 'scripts/claimTrackerIssue.ts', runner: 'runClaimTrackerIssueCli' },
    'issue:reconcile': { path: 'scripts/reconcileTrackerIssue.ts', runner: 'runReconcileTrackerIssueCli' },
    'lane:publish': { path: 'scripts/publishLane.ts', runner: 'runPublishLaneCli' },
    'lane:sync-parent': { path: 'scripts/syncParentLane.ts', runner: 'runSyncParentCli' },
    'review:accept': { path: 'scripts/acceptReview.ts', runner: 'runAcceptReviewCli' },
    'review:publish': { path: 'scripts/publishReview.ts', runner: 'runPublishReviewCli' },
    'review:publish:recover': { path: 'scripts/recoverPublishReviewLock.ts', runner: 'runRecoverPublishReviewLockCli' },
    'review:repair': { path: 'scripts/repairReviewFinding.ts', runner: 'runRepairReviewFindingCli' },
    'review:confirm': { path: 'scripts/confirmReviewRepairs.ts', runner: 'runConfirmReviewRepairsCli' },
    'review:resolve': { path: 'scripts/resolveThread.ts', runner: 'runResolveReviewThreadCli' },
    'review:shadow-status': { path: 'scripts/reviewShadowStatus.ts', runner: 'runReviewShadowStatusCli' },
    'ruleset:harden': { path: 'scripts/rulesetHardening.ts', runner: 'runRulesetHardeningCli' },
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
    for (const shape of snapshotComputedDynamicSpecifiers(source)) {
        throw new Error(
            `${path} loads a module through a computed ${shape} specifier, which the trusted snapshot cannot resolve`
        );
    }
}

/** The whole of the loader's exemption: this one package, in this one file, and nothing else. */
const LOADER_EXEMPT_SPECIFIER = 'yaml';

/**
 * Every shape that names a module: a `from '...'` clause, a side-effect `import '...'` statement,
 * dynamic `import(...)` (including static template literals and parenthesized specifiers),
 * `import.meta.resolve(...)`, `require(...)` / `require.resolve(...)`, and chained
 * `createRequire(...)('...')`. Both rules below read these shapes, because a list that saw only `from`
 * accepted the others — and the dynamic call is the shape this loader itself uses, so the
 * bare-specifier rule passed vacuously on the very file it was written to hold.
 *
 * Specifiers are collected by walking syntax, not by regex over raw source. Comments and the contents
 * of string and template literals cannot contribute; only real import/require forms at code depth can.
 * That keeps an example in this comment from being refused as a dependency.
 */
export function snapshotImportSpecifiers(source: string): string[] {
    const specifiers = new Set<string>();
    scanImportSpecifiers(source, 0, source.length, specifiers);
    return [...specifiers];
}

const COMPUTED_DYNAMIC_IMPORT_SHAPE = 'import(...)';
const COMPUTED_REQUIRE_SHAPE = 'require(...)';
const COMPUTED_CREATE_REQUIRE_SHAPE = 'createRequire(...)(...)';

/**
 * The module-loading shapes whose specifier is computed rather than a literal the snapshot can
 * satisfy: `import(expr)`, `require(expr)` / `require.resolve(expr)`, and
 * `createRequire(...)(expr)`. A literal or static-template specifier is carried by
 * `snapshotImportSpecifiers`; a computed one is exactly what the graph check must not silently
 * ignore, because the snapshot writes only the declared sources into a temporary directory and a
 * computed specifier then resolves nothing there — the command dies mid-delivery with
 * `ERR_MODULE_NOT_FOUND` while every graph check reports coverage it does not have. Each such shape
 * is refused, naming the file and the shape.
 *
 * The decided shapes above are the ones a syntax walk can resolve. The shapes it cannot decide are
 * filed as #4818 rather than claimed here: a callee bound to a name (`const load = require;
 * load(expr)`), a specifier the lexer loses behind a statement-position regex literal, and a call
 * the declaration-context rule cannot separate from a declaration (a block whose first statement is
 * a call followed by another block). None weakens the claim for the decided shapes.
 */
export function snapshotComputedDynamicSpecifiers(source: string): string[] {
    const shapes = new Set<string>();
    scanComputedDynamicSpecifiers(source, 0, source.length, shapes);
    return [...shapes];
}

function scanComputedDynamicSpecifiers(
    source: string,
    start: number,
    end: number,
    shapes: Set<string>,
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
            index = scanComputedTemplate(source, index, end, shapes);
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
        const computed = readComputedDynamicLoad(source, index);
        if (computed !== undefined) {
            shapes.add(computed.shape);
            index = computed.end;
            continue;
        }
        index += 1;
    }
    return index;
}

function scanComputedTemplate(source: string, index: number, end: number, shapes: Set<string>): number {
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
            cursor = scanComputedDynamicSpecifiers(source, cursor + 2, end, shapes, true);
            continue;
        }
        cursor += 1;
    }
    return end;
}

type ComputedDynamicLoad = { shape: string; end: number };

function readComputedDynamicLoad(source: string, index: number): ComputedDynamicLoad | undefined {
    if (isKeywordAt(source, index, 'import') && !isPrecededByDotAccess(source, index)) {
        const afterKeyword = skipWhitespace(source, index + 6);
        if (source[afterKeyword] === '(') {
            return computedDynamicLoad(source, afterKeyword, COMPUTED_DYNAMIC_IMPORT_SHAPE, index, true);
        }
        return undefined;
    }
    if (isKeywordAt(source, index, 'require') && !isPrecededByDotAccess(source, index)) {
        let cursor = skipWhitespace(source, index + 7);
        if (source[cursor] === '.') {
            const afterDot = skipWhitespace(source, cursor + 1);
            if (isKeywordAt(source, afterDot, 'resolve')) {
                cursor = afterDot + 7;
            }
        } else if (source.startsWith('?.', cursor)) {
            const afterDot = skipWhitespace(source, cursor + 2);
            if (isKeywordAt(source, afterDot, 'resolve')) {
                cursor = afterDot + 7;
            }
        }
        cursor = skipWhitespace(source, cursor);
        if (source.startsWith('?.', cursor) && source[skipWhitespace(source, cursor + 2)] === '(') {
            cursor = skipWhitespace(source, cursor + 2);
        }
        if (source[cursor] === '(') {
            return computedDynamicLoad(source, cursor, COMPUTED_REQUIRE_SHAPE, index, true);
        }
        return undefined;
    }
    if (isKeywordAt(source, index, 'createRequire') && !isPrecededByDotAccess(source, index)) {
        const afterKeyword = skipWhitespace(source, index + 13);
        if (source[afterKeyword] === '(') {
            const afterFirstCall = skipBalancedParens(source, afterKeyword);
            if (afterFirstCall !== undefined) {
                let secondCallCursor = skipWhitespace(source, afterFirstCall);
                if (
                    source.startsWith('?.', secondCallCursor) &&
                    source[skipWhitespace(source, secondCallCursor + 2)] === '('
                ) {
                    secondCallCursor = skipWhitespace(source, secondCallCursor + 2);
                }
                if (source[secondCallCursor] === '(') {
                    return computedDynamicLoad(source, secondCallCursor, COMPUTED_CREATE_REQUIRE_SHAPE, index, false);
                }
            }
        }
        return undefined;
    }
    return undefined;
}

function computedDynamicLoad(
    source: string,
    openParen: number,
    shape: string,
    keywordIndex: number,
    declarationCandidate: boolean
): ComputedDynamicLoad | undefined {
    const callEnd = endOfBalancedCall(source, openParen);
    const contentEnd = callEnd - 1;
    // `import` and `require` can also name a declaration — a function, method, or parameter — in
    // which case the parenthesized list is a parameter list and no module load follows.
    // `createRequire(...)(...)` cannot: its second call is always a load. The declaration context
    // that decides is described on `isParameterListRegion`.
    if (declarationCandidate && isParameterListRegion(source, keywordIndex, openParen + 1, contentEnd, callEnd)) {
        return undefined;
    }
    // The specifier is static only when a string or static-template literal is the whole first
    // argument — the argument list's `)` or an argument-level `,` follows it, optionally through
    // grouping parentheses and `as`/`satisfies` casts. Anything after the literal that is not one
    // of those (an operator, member access, call, or concatenation) is computed.
    if (staticSpecifierEnd(source, openParen + 1, contentEnd) !== undefined) {
        return undefined;
    }
    return { shape, end: callEnd };
}

function isParameterListRegion(
    source: string,
    keywordIndex: number,
    start: number,
    end: number,
    afterParen: number
): boolean {
    // A `{` body or a `:` return type right after the closing parenthesis marks the list as a
    // declaration only when the enclosing construct is a declaration — the token before the name is
    // `function`, a method position, or a parameter position. The next token alone does not decide:
    // `flag ? require(spec) : undefined`, `case require(spec):`, `class X extends require(spec) {}`,
    // and `require(spec)\n{ … }` all close the parenthesis with `{` or `:` and are calls, and
    // `isDeclarationContext` reads the name's position to refuse them.
    const afterClose = skipWhitespace(source, afterParen);
    if (source[afterClose] === '{' || source[afterClose] === ':') {
        return isDeclarationContext(source, keywordIndex);
    }
    // An annotated parameter list is still recognized even when no body or return type follows it
    // (for example an ambient overload `declare function require(name: string);`).
    return isAnnotatedParameterListRegion(source, start, end);
}

/**
 * Modifiers that can precede a declaration name. A modifier is skipped while walking back from the
 * name so the enclosing construct — `function`, `{`, `(`, or `,` — decides the declaration, never the
 * modifier alone: `static require(...)` is a method, but `case require(x):` and `default require(x)`
 * stay calls because `case` and `default` are not modifiers.
 */
const DECLARATION_MODIFIERS: ReadonlySet<string> = new Set([
    'static',
    'async',
    'public',
    'protected',
    'private',
    'abstract',
    'readonly',
    'get',
    'set',
    'override',
    'declare',
]);

function isDeclarationContext(source: string, keywordIndex: number): boolean {
    // The name is declared when the token before it is `function` (a function declaration), `{` (a
    // method in a class, object, or type body), or `(` / `,` (a parameter whose type is a call
    // signature). A modifier or a generator asterisk before the name is skipped so the enclosing
    // construct decides, never the modifier alone. Anything else — `?`, `case`, `extends`, a
    // statement boundary — leaves the token a callee, so the parenthesized list is a call.
    //
    // A later member is preceded by `}` (the previous method's body) or `;` (the previous member),
    // not by the body's `{`, so the one-token look refuses it. The enclosing construct decides
    // instead: a `}`/`;`-preceded name inside a class, interface, or type-literal body is a member
    // declaration whatever precedes it, while the same name in a statement block stays a call. A
    // block whose first statement is a call followed by another block (`{ require(spec) { … } }`) is
    // indistinguishable from an object method by this token look, and is filed as #4818 rather than
    // silently misread as a declaration.
    let cursor = keywordIndex - 1;
    while (cursor >= 0) {
        const character = source[cursor];
        if (character === undefined) {
            return false;
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
        // A `//` comment's last character is not a token: `flag ? // {` would otherwise be read as a
        // `{` method position. Skip back to before the `//` so the token before the name is read.
        const lineComment = lineCommentOpenBefore(source, cursor);
        if (lineComment !== undefined) {
            cursor = lineComment - 1;
            continue;
        }
        if (character === '{' || character === '(' || character === ',') {
            return true;
        }
        // A generator asterisk sits between the enclosing construct and the name; skip it and keep
        // walking so the construct before it decides.
        if (character === '*') {
            cursor -= 1;
            continue;
        }
        if (character === '}' || character === ';') {
            return isMemberInsideClassLikeBody(source, keywordIndex);
        }
        if (isIdentifierContinue(character)) {
            let identifierStart = cursor;
            while (identifierStart >= 0 && isIdentifierContinue(source[identifierStart])) {
                identifierStart -= 1;
            }
            const word = source.slice(identifierStart + 1, cursor + 1);
            if (word === 'function') {
                return true;
            }
            if (DECLARATION_MODIFIERS.has(word)) {
                cursor = identifierStart - 1;
                continue;
            }
            return false;
        }
        return false;
    }
    return false;
}

/**
 * Whether a `require`/`import` name preceded by `}` or `;` is a member of a class, interface, or
 * type-literal body — the innermost `{` enclosing the name must be one such body rather than a
 * statement block. The statement-block shapes stay refused, and the first-statement block case named
 * in `isDeclarationContext` never reaches here because its name is preceded by `{`, not `}` or `;`.
 */
function isMemberInsideClassLikeBody(source: string, keywordIndex: number): boolean {
    const open = enclosingBraceOpen(source, keywordIndex);
    if (open === undefined) {
        return false;
    }
    return classLikeBodyOpenBefore(source, open);
}

/**
 * The index of the `{` that opens the innermost brace-delimited region containing `keywordIndex`,
 * skipping braces that belong to string, template, or comment content on the way, or `undefined`
 * when no such brace precedes the name. Regex literals are not skipped here: a brace inside a regex
 * body is an expression token this walk does not read.
 */
function enclosingBraceOpen(source: string, keywordIndex: number): number | undefined {
    let cursor = keywordIndex - 1;
    let depth = 0;
    while (cursor >= 0) {
        const character = source[cursor];
        if (character === undefined) {
            return undefined;
        }
        if (isWhiteSpace(character) || isLineTerminator(character)) {
            cursor -= 1;
            continue;
        }
        if (character === '/' && cursor >= 1 && source[cursor - 1] === '*') {
            const open = source.lastIndexOf('/*', cursor - 1);
            if (open === -1) {
                return undefined;
            }
            cursor = open - 1;
            continue;
        }
        const lineComment = lineCommentOpenBefore(source, cursor);
        if (lineComment !== undefined) {
            cursor = lineComment - 1;
            continue;
        }
        if (character === '"' || character === "'") {
            const open = skipQuotedBackward(source, cursor, character);
            cursor = open === undefined ? cursor - 1 : open - 1;
            continue;
        }
        if (character === '`') {
            const open = skipTemplateBackward(source, cursor);
            cursor = open === undefined ? cursor - 1 : open - 1;
            continue;
        }
        if (character === '}') {
            depth += 1;
            cursor -= 1;
            continue;
        }
        if (character === '{') {
            if (depth === 0) {
                return cursor;
            }
            depth -= 1;
            cursor -= 1;
            continue;
        }
        cursor -= 1;
    }
    return undefined;
}

/** Statement and block construct keywords that end a class/interface/type header scan. */
const BLOCK_INTRODUCER_KEYWORDS: ReadonlySet<string> = new Set([
    'function',
    'const',
    'let',
    'var',
    'if',
    'else',
    'for',
    'while',
    'do',
    'switch',
    'case',
    'default',
    'try',
    'catch',
    'finally',
    'throw',
    'return',
    'new',
    'await',
    'yield',
    'with',
    'import',
    'namespace',
    'enum',
    'module',
]);

/**
 * Whether the `{` at `openIndex` opens a class, interface, or type-literal body. The scan walks back
 * over the header — a name, a `type Name =` clause, a heritage or implements clause, and balanced
 * parentheses or brackets inside them — and stops, refusing, at any statement or block keyword or
 * unmatched punctuation, so a `type` keyword in an earlier statement cannot claim a later block.
 */
function classLikeBodyOpenBefore(source: string, openIndex: number): boolean {
    let cursor = openIndex - 1;
    let delimiterDepth = 0;
    while (cursor >= 0) {
        const character = source[cursor];
        if (character === undefined) {
            return false;
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
        const lineComment = lineCommentOpenBefore(source, cursor);
        if (lineComment !== undefined) {
            cursor = lineComment - 1;
            continue;
        }
        if (character === '"' || character === "'") {
            const open = skipQuotedBackward(source, cursor, character);
            cursor = open === undefined ? cursor - 1 : open - 1;
            continue;
        }
        if (character === '`') {
            const open = skipTemplateBackward(source, cursor);
            cursor = open === undefined ? cursor - 1 : open - 1;
            continue;
        }
        if (character === ')' || character === ']') {
            delimiterDepth += 1;
            cursor -= 1;
            continue;
        }
        if ((character === '(' || character === '[') && delimiterDepth > 0) {
            delimiterDepth -= 1;
            cursor -= 1;
            continue;
        }
        if (delimiterDepth > 0) {
            cursor -= 1;
            continue;
        }
        if (isIdentifierContinue(character)) {
            const word = readWordBackward(source, cursor);
            if (word === 'class' || word === 'interface' || word === 'type') {
                return true;
            }
            if (BLOCK_INTRODUCER_KEYWORDS.has(word)) {
                return false;
            }
            cursor -= word.length;
            continue;
        }
        if (character === '.' || character === ',' || character === '=' || character === '|' || character === '&') {
            cursor -= 1;
            continue;
        }
        return false;
    }
    return false;
}

/** The opening quote of the string literal whose closing quote is at `index`, or `undefined`. */
function skipQuotedBackward(source: string, index: number, quote: "'" | '"'): number | undefined {
    let cursor = index - 1;
    while (cursor >= 0) {
        const character = source[cursor];
        if (character === undefined) {
            return undefined;
        }
        if (character === '\\') {
            cursor -= 2;
            continue;
        }
        if (character === quote) {
            return cursor;
        }
        if (isLineTerminator(character)) {
            return undefined;
        }
        cursor -= 1;
    }
    return undefined;
}

/** The opening backtick of the template literal whose closing backtick is at `index`, or `undefined`. */
function skipTemplateBackward(source: string, index: number): number | undefined {
    let cursor = index - 1;
    while (cursor >= 0) {
        const character = source[cursor];
        if (character === '\\') {
            cursor -= 2;
            continue;
        }
        if (character === '`') {
            return cursor;
        }
        cursor -= 1;
    }
    return undefined;
}

/** The identifier word ending at `cursor`, read backward to its first character. */
function readWordBackward(source: string, cursor: number): string {
    let start = cursor;
    while (start >= 0 && isIdentifierContinue(source[start])) {
        start -= 1;
    }
    return source.slice(start + 1, cursor + 1);
}

/**
 * The index of the `//` that opens the line comment containing `cursor`, or `undefined` when the
 * cursor is not inside a `//` comment. Walking the line forward from its start — skipping string,
 * template, and regex literals and block comments — keeps a `//` inside a quoted value, a regex, or a
 * block comment from masking a real token.
 */
function lineCommentOpenBefore(source: string, cursor: number): number | undefined {
    let lineStart = cursor;
    while (lineStart >= 0 && !isLineTerminator(source[lineStart] ?? '')) {
        lineStart -= 1;
    }
    let index = lineStart + 1;
    while (index < cursor) {
        const commentEnd = skipComment(source, index);
        if (commentEnd !== undefined) {
            if (source.startsWith('//', index)) {
                return index;
            }
            index = commentEnd;
            continue;
        }
        const regexEnd = skipRegexLiteral(source, index);
        if (regexEnd !== undefined) {
            index = regexEnd;
            continue;
        }
        const character = source[index];
        if (character === "'" || character === '"') {
            index = skipQuoted(source, index, character);
            continue;
        }
        if (character === '`') {
            index = scanTemplate(source, index, cursor, new Set());
            continue;
        }
        index += 1;
    }
    return undefined;
}

function isAnnotatedParameterListRegion(source: string, start: number, end: number): boolean {
    let cursor = skipWhitespace(source, start);
    if (cursor >= end) {
        return true;
    }
    if (source.startsWith('...', cursor)) {
        cursor = skipWhitespace(source, cursor + 3);
    }
    const afterBinding = skipBindingPattern(source, cursor, end);
    if (afterBinding === undefined) {
        return false;
    }
    cursor = skipWhitespace(source, afterBinding);
    if (source[cursor] === '?') {
        // An optional parameter's `?` is followed directly by `:`; a ternary's is not.
        cursor = skipWhitespace(source, cursor + 1);
        return source[cursor] === ':';
    }
    return source[cursor] === ':';
}

function skipBindingPattern(source: string, start: number, end: number): number | undefined {
    const first = source[start];
    if (first === undefined) {
        return undefined;
    }
    if (/[A-Za-z_$]/.test(first)) {
        let cursor = start + 1;
        while (cursor < end && isIdentifierContinue(source[cursor])) {
            cursor += 1;
        }
        return cursor;
    }
    if (first === '{') {
        return skipBalancedDelimited(source, start, end, '{', '}');
    }
    if (first === '[') {
        return skipBalancedDelimited(source, start, end, '[', ']');
    }
    return undefined;
}

function skipBalancedDelimited(
    source: string,
    start: number,
    end: number,
    open: string,
    close: string
): number | undefined {
    let cursor = start;
    let depth = 0;
    while (cursor < end) {
        const commentEnd = skipComment(source, cursor);
        if (commentEnd !== undefined) {
            cursor = Math.min(commentEnd, end);
            continue;
        }
        const quote = source[cursor];
        if (quote === "'" || quote === '"') {
            cursor = skipQuoted(source, cursor, quote);
            continue;
        }
        if (quote === '`') {
            cursor = scanTemplate(source, cursor, end, new Set());
            continue;
        }
        const character = source[cursor];
        if (character === open) {
            depth += 1;
        } else if (character === close) {
            depth -= 1;
            if (depth === 0) {
                return cursor + 1;
            }
        }
        cursor += 1;
    }
    return undefined;
}

function staticSpecifierEnd(source: string, start: number, end: number): number | undefined {
    const expressionEnd = readStaticSpecifier(source, start, end);
    if (expressionEnd === undefined) {
        return undefined;
    }
    const after = skipWhitespace(source, expressionEnd);
    if (after === end || source[after] === ',') {
        return expressionEnd;
    }
    return undefined;
}

function readStaticSpecifier(source: string, start: number, end: number): number | undefined {
    let cursor = skipWhitespace(source, start);
    if (cursor >= end) {
        return undefined;
    }
    // A leading angle-bracket assertion is erased at run time exactly as `as` is, so the specifier
    // stays the literal; skip it and read the asserted expression.
    while (source[cursor] === '<') {
        const afterType = skipTypeArguments(source, cursor, end);
        if (afterType === undefined) {
            return undefined;
        }
        cursor = skipWhitespace(source, afterType);
        if (cursor >= end) {
            return undefined;
        }
    }
    const first = source[cursor];
    let literalEnd: number | undefined;
    if (first === "'" || first === '"') {
        const read = readQuotedValue(source, cursor, first);
        if (read === undefined) {
            return undefined;
        }
        literalEnd = read.end;
    } else if (first === '`') {
        const read = readStaticTemplateValue(source, cursor);
        if (read === undefined) {
            return undefined;
        }
        literalEnd = read.end;
    } else if (first === '(') {
        const closeParen = skipBalancedParens(source, cursor);
        if (closeParen === undefined || closeParen - 1 > end) {
            return undefined;
        }
        const innerEnd = readStaticSpecifier(source, cursor + 1, closeParen - 1);
        if (innerEnd === undefined || skipWhitespace(source, innerEnd) !== closeParen - 1) {
            return undefined;
        }
        literalEnd = closeParen;
    } else {
        return undefined;
    }
    // A literal may carry a postfix non-null assertion and any number of chained `as`/`satisfies`
    // casts, in any order. Each is erased at run time, so the value stays the literal, but it must be
    // skipped so the caller can tell the specifier's end from a value-modifying operator that follows
    // it.
    let current = literalEnd;
    while (true) {
        const after = skipWhitespace(source, current);
        if (source[after] === '!') {
            current = after + 1;
            continue;
        }
        let typeStart: number | undefined;
        if (isKeywordAt(source, after, 'as')) {
            typeStart = after + 2;
        } else if (isKeywordAt(source, after, 'satisfies')) {
            typeStart = after + 9;
        } else {
            break;
        }
        current = skipTypeExpression(source, typeStart, end);
    }
    return current;
}

const TYPE_TERMINATOR_CHARACTERS = new Set(['+', '-', '*', '/', '%', '^', '~', '!', '?', ':', '=', ';']);

function isDecimalDigit(character: string | undefined): boolean {
    return character !== undefined && character >= '0' && character <= '9';
}

/**
 * Consumes the type of an `as`/`satisfies` cast, whatever shape it takes: a plain or qualified name,
 * an array or tuple suffix, a generic, a function type, an object type, a union/intersection, a
 * conditional type (`A extends B ? C : D`), a literal type (`-1`), or a `typeof` query. The type is
 * erased at run time, so the specifier value stays the literal, but the scanner must know where the
 * cast ends to tell it apart from an operator that follows the literal. It walks to the
 * argument-level comma or the closing parenthesis of the call, tracking balanced `()`, `[]`, `{}`,
 * and `<>` so a comma inside a generic, tuple, function, or object type does not end the cast, and
 * stops at a chained `as`/`satisfies` so the caller can chain it.
 *
 * Several shapes would otherwise end the cast early or swallow the operator after it, and are
 * decided here rather than by the terminator set alone: a `<` is a type-argument opener only when
 * its level closes before the cast ends (otherwise it is a value comparison and the cast ends before
 * it); a conditional type's `?` and `:` are type syntax once an `extends` precedes them at the same
 * level, paired per nesting depth (otherwise `?` is a value ternary and the cast ends before it); a
 * leading `-`/`+` on a numeric literal type is part of the type only where a type atom begins
 * (otherwise it is a value operator and the cast ends before it); and a word operator — `&&`, `||`,
 * `instanceof`, `in` — always ends the cast because none is type syntax.
 */
function skipTypeExpression(source: string, start: number, end: number): number {
    let cursor = skipWhitespace(source, start);
    const openers: Array<')' | ']' | '}' | '>'> = [];
    // Conditional types pair each top-level `extends` with the `?` that opens its true branch and
    // each such `?` with its `:`. Pairing nests — `A extends B ? C extends D ? E : F : G` and
    // `A extends () => B extends C ? D : E ? F : G` both carry two conditionals at one level — so a
    // stack replaces a one-shot arm: a nested conditional's `?`/`:` cannot consume the outer
    // `extends`'s arm. A top-level `?` with no armed `extends` is a value ternary and ends the cast.
    const conditionals: Array<'extends' | 'conditional'> = [];
    // Whether a type atom has been consumed at the top level. A `-` directly before a digit is the
    // sign of a numeric literal type only where a type atom begins (the leading `-1`); after a
    // completed type it is a value `-`/`+` operator and ends the cast.
    let typeStarted = false;
    while (cursor < end) {
        const commentEnd = skipComment(source, cursor);
        if (commentEnd !== undefined) {
            cursor = Math.min(commentEnd, end);
            continue;
        }
        const character = source[cursor];
        if (character === undefined) {
            return cursor;
        }
        if (isWhiteSpace(character) || isLineTerminator(character)) {
            cursor += 1;
            continue;
        }
        if (character === "'" || character === '"') {
            cursor = skipQuoted(source, cursor, character);
            typeStarted = true;
            continue;
        }
        if (character === '`') {
            cursor = scanTemplate(source, cursor, end, new Set());
            typeStarted = true;
            continue;
        }
        if (character === '=' && source[cursor + 1] === '>') {
            cursor += 2;
            typeStarted = false;
            continue;
        }
        if (character === '<') {
            // A `<` whose generic level never closes before the cast ends is a value comparison, not
            // a type-argument opener: `as string < 'y' ? ...` compares the cast value, so the cast
            // ends here and the ternary after it is expression syntax again.
            if (skipTypeArguments(source, cursor, end) === undefined) {
                return cursor;
            }
            openers.push('>');
            cursor += 1;
            continue;
        }
        if (character === '(' || character === '[' || character === '{') {
            openers.push(matchingTypeDelimiter(character));
            cursor += 1;
            continue;
        }
        if (character === ')' || character === ']' || character === '}' || character === '>') {
            const top = openers[openers.length - 1];
            if (top === undefined || top !== character) {
                // An unmatched closer ends the type before it; the caller then refuses.
                return cursor;
            }
            openers.pop();
            cursor += 1;
            typeStarted = true;
            continue;
        }
        if (openers.length === 0) {
            if (character === ',') {
                return cursor;
            }
            if (isKeywordAt(source, cursor, 'as') || isKeywordAt(source, cursor, 'satisfies')) {
                return cursor;
            }
            if (isKeywordAt(source, cursor, 'extends')) {
                conditionals.push('extends');
                typeStarted = false;
                cursor += 'extends'.length;
                continue;
            }
            if (character === '?') {
                if (conditionals[conditionals.length - 1] === 'extends') {
                    conditionals.pop();
                    conditionals.push('conditional');
                    typeStarted = false;
                    cursor += 1;
                    continue;
                }
                return cursor;
            }
            if (character === ':') {
                if (conditionals[conditionals.length - 1] === 'conditional') {
                    conditionals.pop();
                    typeStarted = false;
                    cursor += 1;
                    continue;
                }
                return cursor;
            }
            if (character === '-' && isDecimalDigit(source[cursor + 1]) && !typeStarted) {
                typeStarted = true;
                cursor += 1;
                continue;
            }
            if ((character === '-' || character === '+') && isDecimalDigit(source[cursor + 1])) {
                return cursor;
            }
            if (isKeywordAt(source, cursor, 'instanceof') || isKeywordAt(source, cursor, 'in')) {
                return cursor;
            }
            if (source.startsWith('&&', cursor) || source.startsWith('||', cursor)) {
                return cursor;
            }
            if (character === '|' || character === '&') {
                typeStarted = false;
                cursor += 1;
                continue;
            }
            if (TYPE_TERMINATOR_CHARACTERS.has(character)) {
                return cursor;
            }
            typeStarted = true;
        }
        cursor += 1;
    }
    return cursor;
}

/**
 * The end of the type-argument list a `<` at `openIndex` opens, or `undefined` when no `>` closes it
 * before `end`. `=>` is skipped so an arrow's `>` is not read as the close, and `>=` is skipped so a
 * value comparison is not read as one either.
 */
function skipTypeArguments(source: string, openIndex: number, end: number): number | undefined {
    let cursor = openIndex + 1;
    let depth = 1;
    while (cursor < end) {
        const commentEnd = skipComment(source, cursor);
        if (commentEnd !== undefined) {
            cursor = Math.min(commentEnd, end);
            continue;
        }
        const character = source[cursor];
        if (character === undefined) {
            break;
        }
        if (character === "'" || character === '"') {
            cursor = skipQuoted(source, cursor, character);
            continue;
        }
        if (character === '`') {
            cursor = scanTemplate(source, cursor, end, new Set());
            continue;
        }
        if (character === '=' && source[cursor + 1] === '>') {
            cursor += 2;
            continue;
        }
        if (character === '<') {
            depth += 1;
            cursor += 1;
            continue;
        }
        if (character === '>') {
            if (source[cursor + 1] === '=') {
                cursor += 2;
                continue;
            }
            depth -= 1;
            cursor += 1;
            if (depth === 0) {
                return cursor;
            }
            continue;
        }
        cursor += 1;
    }
    return undefined;
}

function matchingTypeDelimiter(open: '(' | '[' | '{' | '<'): ')' | ']' | '}' | '>' {
    if (open === '(') {
        return ')';
    }
    if (open === '[') {
        return ']';
    }
    if (open === '{') {
        return '}';
    }
    return '>';
}

function endOfBalancedCall(source: string, openParen: number): number {
    const end = skipBalancedParens(source, openParen);
    return end === undefined ? source.length : end;
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
                if (!isPrecededByDotAccess(source, index)) {
                    specifiers.add(dynamic.value);
                }
                index = dynamic.end;
                continue;
            }
            const metaResolve = readImportMetaResolveSpecifier(source, index);
            if (metaResolve !== undefined) {
                specifiers.add(metaResolve.value);
                index = metaResolve.end;
                continue;
            }
        }
        if (isKeywordAt(source, index, 'require')) {
            if (!isPrecededByDotAccess(source, index)) {
                let cursor = skipWhitespace(source, index + 7);
                if (source[cursor] === '.') {
                    const afterDot = skipWhitespace(source, cursor + 1);
                    if (isKeywordAt(source, afterDot, 'resolve')) {
                        cursor = afterDot + 7;
                    }
                } else if (source.startsWith('?.', cursor)) {
                    const afterDot = skipWhitespace(source, cursor + 2);
                    if (isKeywordAt(source, afterDot, 'resolve')) {
                        cursor = afterDot + 7;
                    }
                }
                cursor = skipWhitespace(source, cursor);
                if (source.startsWith('?.', cursor) && source[skipWhitespace(source, cursor + 2)] === '(') {
                    cursor = skipWhitespace(source, cursor + 2);
                }
                const spec = readDynamicImportSpecifier(source, cursor);
                if (spec !== undefined) {
                    specifiers.add(spec.value);
                    index = spec.end;
                    continue;
                }
            }
        }
        if (isKeywordAt(source, index, 'createRequire')) {
            if (!isPrecededByDotAccess(source, index)) {
                const afterKeyword = skipWhitespace(source, index + 13);
                if (source[afterKeyword] === '(') {
                    const afterFirstCall = skipBalancedParens(source, afterKeyword);
                    if (afterFirstCall !== undefined) {
                        let secondCallCursor = skipWhitespace(source, afterFirstCall);
                        if (
                            source.startsWith('?.', secondCallCursor) &&
                            source[skipWhitespace(source, secondCallCursor + 2)] === '('
                        ) {
                            secondCallCursor = skipWhitespace(source, secondCallCursor + 2);
                        }
                        const spec = readDynamicImportSpecifier(source, secondCallCursor);
                        if (spec !== undefined) {
                            specifiers.add(spec.value);
                            index = spec.end;
                            continue;
                        }
                    }
                }
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
        while (source[cursor] === '<') {
            const afterType = skipTypeArguments(source, cursor, source.length);
            if (afterType === undefined) {
                break;
            }
            cursor = skipWhitespace(source, afterType);
        }
        if (source[cursor] !== '(') {
            break;
        }
        cursor += 1;
    }
    return readModuleStringAfter(source, cursor);
}

function skipBalancedParens(source: string, index: number): number | undefined {
    if (source[index] !== '(') {
        return undefined;
    }
    let cursor = index;
    let depth = 0;
    while (cursor < source.length) {
        const commentEnd = skipComment(source, cursor);
        if (commentEnd !== undefined) {
            cursor = commentEnd;
            continue;
        }
        const character = source[cursor];
        if (character === "'" || character === '"') {
            cursor = skipQuoted(source, cursor, character);
            continue;
        }
        if (character === '`') {
            cursor = scanTemplate(source, cursor, source.length, new Set());
            continue;
        }
        const regexEnd = skipRegexLiteral(source, cursor);
        if (regexEnd !== undefined) {
            cursor = regexEnd;
            continue;
        }
        if (character === '(') {
            depth += 1;
            cursor += 1;
            continue;
        }
        if (character === ')') {
            depth -= 1;
            cursor += 1;
            if (depth === 0) {
                return cursor;
            }
            continue;
        }
        cursor += 1;
    }
    return undefined;
}

function readImportMetaResolveSpecifier(source: string, index: number): ReadSpecifier | undefined {
    if (!isKeywordAt(source, index, 'import') || isPrecededByDotAccess(source, index)) {
        return undefined;
    }
    let cursor = skipWhitespace(source, index + 6);
    if (source.startsWith('?.', cursor)) {
        cursor = skipWhitespace(source, cursor + 2);
    } else if (source[cursor] === '.') {
        cursor = skipWhitespace(source, cursor + 1);
    } else {
        return undefined;
    }
    if (!isKeywordAt(source, cursor, 'meta')) {
        return undefined;
    }
    cursor = skipWhitespace(source, cursor + 4);
    if (source.startsWith('?.', cursor)) {
        cursor = skipWhitespace(source, cursor + 2);
    } else if (source[cursor] === '.') {
        cursor = skipWhitespace(source, cursor + 1);
    } else {
        return undefined;
    }
    if (!isKeywordAt(source, cursor, 'resolve')) {
        return undefined;
    }
    let afterResolve = skipWhitespace(source, cursor + 7);
    if (source.startsWith('?.', afterResolve) && source[skipWhitespace(source, afterResolve + 2)] === '(') {
        afterResolve = skipWhitespace(source, afterResolve + 2);
    }
    return readDynamicImportSpecifier(source, afterResolve);
}

function isPrecededByDotAccess(source: string, index: number): boolean {
    let cursor = index - 1;
    while (cursor >= 0) {
        const character = source[cursor]!;
        if (isWhiteSpace(character) || isLineTerminator(character)) {
            cursor -= 1;
            continue;
        }
        if (character === '/' && cursor >= 1 && source[cursor - 1] === '*') {
            const open = source.lastIndexOf('/*', cursor - 1);
            if (open === -1) {
                break;
            }
            cursor = open - 1;
            continue;
        }
        // A `//` comment's last character is not a token: a comment ending in `.` would otherwise be
        // read as the member-access dot. Skip back to before the `//` so the token before the name is
        // read, matching the declaration-context walk.
        const lineComment = lineCommentOpenBefore(source, cursor);
        if (lineComment !== undefined) {
            cursor = lineComment - 1;
            continue;
        }
        if (character === '.') {
            // A spread's three dots are not member access; skip the whole token so the token before
            // the spread decides.
            if (cursor >= 2 && source.slice(cursor - 2, cursor + 1) === '...') {
                cursor -= 3;
                continue;
            }
            return true;
        }
        return false;
    }
    return false;
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

/**
 * The static local-import closure of `entry`: every module reached by walking `./`-relative literal or
 * static-template imports from `entry` and, transitively, from each module it reaches, using the same
 * import scan the graph check uses. Type-only edges (`import type`, `export type ... from`) are
 * included deliberately: Node's type stripping erases them, so this closure is a superset of what the
 * command actually executes, but the very same union feeds the governance risk classification and must
 * not shrink — narrowing it to the executed graph would silently drop a changed script from
 * `native-security` classification. `readSource` supplies each module's source from the working tree,
 * so the walk crosses an undeclared intermediate instead of stopping at it. The walk refuses rather
 * than silently truncates: a reached module with no source, or a computed `import(expr)` /
 * `require(expr)` / `createRequire(...)(expr)` specifier, throws — those shapes cannot be resolved from
 * a snapshot and must not be skipped. The computed shapes it cannot decide — a callee bound to a name,
 * a specifier the lexer loses behind a statement-position regex, and a call the declaration-context
 * rule cannot separate from a declaration — are filed as #4818 and are not claimed here. The loader
 * itself is deliberately absent from a command's
 * executed graph — no executed source may import it, which `assertTrustedSourceGraph` refuses — so a
 * command's declared set is exactly this closure plus the loader's own static-import closure. Exported
 * so the specs pinning each command's declared set to its static closure can see over- and
 * under-declaration, which the runtime check alone cannot: it only proves the declared set is closed
 * under imports.
 */
export function trustedLocalImportClosure(
    entry: string,
    readSource: (path: string) => string | undefined
): ReadonlySet<string> {
    const closure = new Set<string>();
    const pending = [entry];
    while (pending.length > 0) {
        const path = pending.pop();
        if (path === undefined || closure.has(path)) {
            continue;
        }
        closure.add(path);
        const source = readSource(path);
        if (source === undefined) {
            throw new Error(`local import closure cannot read ${path}, which ${entry} reaches`);
        }
        for (const shape of snapshotComputedDynamicSpecifiers(source)) {
            throw new Error(
                `${path} loads a module through a computed ${shape} specifier, which the trusted snapshot cannot resolve`
            );
        }
        for (const dependency of localModuleDependencies(path, source)) {
            if (!closure.has(dependency)) {
                pending.push(dependency);
            }
        }
    }
    return closure;
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
    return summarizeGateWorkflow(source, (usesPath) => port.readOriginSource(commit, usesPath));
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
export async function summarizeGateWorkflow(
    source: string,
    readCalled?: (usesPath: string) => string
): Promise<TrustedGateWorkflow> {
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
    const summary = summarizeJobs(jobs);
    const called: Record<string, TrustedCalledWorkflow> = Object.create(null) as Record<string, TrustedCalledWorkflow>;
    if (readCalled !== undefined) {
        for (const job of Object.values(summary)) {
            // Only a local call can be read at the pinned commit. Anything else stays uncarried, and
            // deriving what that means stays the gate's rule exactly as an unreadable file does.
            if (typeof job.uses !== 'string' || !job.uses.startsWith('./') || job.uses in called) {
                continue;
            }
            called[job.uses] = await summarizeCalledWorkflow(job.uses, readCalled);
        }
    }
    return { jobs: summary, called };
}

/**
 * A called workflow crosses with the same fidelity as the caller: nothing resolved, nothing
 * filtered. A file that cannot be read or parsed crosses as the reason, so the refusal is worded
 * and owned by the gate rather than thrown here.
 */
async function summarizeCalledWorkflow(
    usesPath: string,
    readCalled: (usesPath: string) => string
): Promise<TrustedCalledWorkflow> {
    let source: string;
    try {
        source = readCalled(usesPath);
    } catch (error) {
        return { unreadable: `it cannot be read at the pinned commit: ${errorDetail(error)}` };
    }
    let workflow: unknown;
    try {
        workflow = await parseYaml(source);
    } catch (error) {
        return { unreadable: `it is not valid YAML: ${errorDetail(error)}` };
    }
    if (!isRecord(workflow) || !isRecord(workflow.jobs)) {
        return { unreadable: 'it declares no jobs mapping' };
    }
    return { name: carriedName(workflow.name), jobs: summarizeJobs(workflow.jobs) };
}

function summarizeJobs(jobs: Record<string, unknown>): Record<string, TrustedWorkflowJob> {
    // A job id is workflow-controlled text, and GitHub accepts `__proto__` as one. Assigning that
    // key on an object literal moves the prototype instead of creating an own property, and
    // `JSON.stringify` then drops the job from the summary entirely — so the gate never sees a job
    // the workflow declares. A prototype-free map has no such key to hit.
    const summary: Record<string, TrustedWorkflowJob> = Object.create(null) as Record<string, TrustedWorkflowJob>;
    for (const [jobId, job] of Object.entries(jobs)) {
        summary[jobId] = isRecord(job)
            ? { name: carriedName(job.name), needs: job.needs, uses: job.uses, strategy: job.strategy }
            : {};
    }
    return summary;
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
        'const trustedLauncher = typeof process.env.SOURDAW_TRUSTED_PRIMARY_ROOT === "string" && typeof process.env.SOURDAW_TRUSTED_GIT_PATH === "string" && typeof process.env.SOURDAW_TRUSTED_GH_PATH === "string" ? { primaryRoot: process.env.SOURDAW_TRUSTED_PRIMARY_ROOT, gitPath: process.env.SOURDAW_TRUSTED_GIT_PATH, ghPath: process.env.SOURDAW_TRUSTED_GH_PATH, ...(typeof process.env.SOURDAW_TRUSTED_PS_PATH === "string" ? { psPath: process.env.SOURDAW_TRUSTED_PS_PATH } : {}), ...(typeof process.env.SOURDAW_TRUSTED_POWERSHELL_PATH === "string" ? { powershellPath: process.env.SOURDAW_TRUSTED_POWERSHELL_PATH } : {}), ...(typeof process.env.SOURDAW_TRUSTED_GIT_AI_PATH === "string" ? { gitAiPath: process.env.SOURDAW_TRUSTED_GIT_AI_PATH } : {}) } : undefined;',
        'const dependencies = runner === "runDeliverCli" ? { trustedLauncher } : undefined;',
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
            ...(launcher.gitAiPath === undefined ? [] : [dirname(launcher.gitAiPath)]),
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
    if (launcher.gitAiPath !== undefined) {
        env[TRUSTED_GIT_AI_PATH_ENV] = launcher.gitAiPath;
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
    name: 'git' | 'gh' | 'ps' | 'git-ai',
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

/**
 * git-ai is operator tooling the delivery authorship sync uses when present; an operator
 * without it keeps the documented skip, so resolution is optional rather than fatal.
 */
function resolveOptionalTrustedExecutable(
    name: 'git-ai',
    parent: NodeJS.ProcessEnv,
    platform: NodeJS.Platform
): string | undefined {
    try {
        return resolveTrustedExecutable(name, parent, platform);
    } catch {
        return undefined;
    }
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
        gitAiPath: command === 'deliver' ? resolveOptionalTrustedExecutable('git-ai', parent, platform) : undefined,
        powershellPath: commandRequiresTrustedPowerShell(command, platform)
            ? resolveTrustedPowerShellExecutable(parent, platform)
            : undefined,
    };
}

function commandRequiresTrustedPs(command: TrustedGithubWriteCommand | undefined, platform: NodeJS.Platform): boolean {
    return platform !== 'win32' && commandFencesItsLockOwner(command);
}

function commandRequiresTrustedPowerShell(
    command: TrustedGithubWriteCommand | undefined,
    platform: NodeJS.Platform
): boolean {
    return platform === 'win32' && commandFencesItsLockOwner(command);
}

/**
 * The launcher's snapshot is only as current as whatever process last fetched the primary's
 * origin/main ref: run right after a lane merges, a launcher that resolves without fetching
 * silently executes the pre-merge closure and reproduces failures the merge just fixed (#4436).
 * Every resolution therefore fetches first, under the operator's ambient environment — the
 * pre-trust window the delivery skill already treats as trusted — because the scrubbed
 * read-only environment strips the credential helper a non-anonymous remote needs. A failed
 * fetch never refuses the run: offline operation keeps working against the local ref, but
 * never silently — the staleness risk and the fetch error are both reported.
 */
export type OriginFetchOutcome = { fresh: true } | { fresh: false; reason: string };

export type OriginFetchSpawn = (
    command: string,
    args: string[],
    options: { cwd: string; env: NodeJS.ProcessEnv }
) => { status: number | null; stderr: string | undefined };

export function fetchOriginMain(
    input: { gitPath: string; primaryRoot: string },
    spawn: OriginFetchSpawn = (command, args, options) => spawnSync(command, args, { ...options, encoding: 'utf8' })
): OriginFetchOutcome {
    const result = spawn(input.gitPath, ['fetch', 'origin', 'main'], {
        cwd: input.primaryRoot,
        env: process.env,
    });
    if (result.status === 0) {
        return { fresh: true };
    }
    const detail = result.stderr?.trim();
    if (detail !== undefined && detail !== '') {
        return { fresh: false, reason: detail };
    }
    return { fresh: false, reason: `git fetch failed without diagnostics (exit ${result.status ?? 'signal'})` };
}

export function defaultPort(binding: TrustedLauncherBinding): TrustedSourcePort {
    return {
        resolveOriginMain: () => {
            const fetch = fetchOriginMain(binding);
            if (!fetch.fresh) {
                console.error(
                    `cannot fetch origin/main (${fetch.reason}); the trusted snapshot may be stale — ` +
                        'this run executes whatever refs/remotes/origin/main last fetched'
                );
            }
            return captureGit(binding.primaryRoot, binding.gitPath, [
                'rev-parse',
                '--verify',
                'refs/remotes/origin/main^{commit}',
            ]).trim();
        },
        readOriginSource: (commit, path) =>
            captureGit(binding.primaryRoot, binding.gitPath, ['show', `${commit}:${path}`]),
        executeSnapshot: (command, args, snapshot) =>
            executeTrustedSnapshot(command, args, { ...snapshot, launcher: binding }),
    };
}

function parseCommand(value: string | undefined): TrustedGithubWriteCommand {
    if (
        value === 'deliver' ||
        value === 'issue:claim' ||
        value === 'issue:reconcile' ||
        value === 'lane:publish' ||
        value === 'lane:sync-parent' ||
        value === 'review:accept' ||
        value === 'review:publish' ||
        value === 'review:publish:recover' ||
        value === 'review:repair' ||
        value === 'review:confirm' ||
        value === 'review:resolve' ||
        value === 'review:shadow-status' ||
        value === 'ruleset:harden'
    ) {
        return value;
    }
    throw new Error(
        'usage: trustedGithubWriteBootstrap.ts <deliver|issue:claim|issue:reconcile|lane:publish|lane:sync-parent|review:accept|review:publish|review:publish:recover|review:repair|review:confirm|review:resolve|review:shadow-status|ruleset:harden> [args...]'
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
