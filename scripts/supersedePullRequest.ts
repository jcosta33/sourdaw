#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
    assertFindingLineage,
    parseFindingLineage,
    parseFindingLineageDocument,
    renderFindingLineage,
    type FindingLineage,
    type LineageFinding,
} from './findingLineage.ts';
import {
    AUTHOR_BOT_NODE_ID,
    REQUIRED_BASE_BRANCH,
    REQUIRED_REPOSITORY,
    assertRequiredRepository,
    assertTrustedExecutingBlob,
    authenticateRole,
    isAuthorBotNodeId,
    originMainBlob,
    resolvePrimaryRoot,
    spawnCapture,
} from './githubAppIdentity.ts';
import { fail, PR_STATE, supersessionCommentBody } from './prContract.ts';
import {
    commentClientMutationId,
    isDecimalId,
    shellPort,
    type AddedIssueCommentReceipt,
    type IssueComment,
    type PullRequestCloseReceipt,
    type SupersedePullRequestPort,
    type SupersededPullRequest,
} from './supersedePullRequestGh.ts';

export type SupersedePullRequestArgs = {
    oldNumber?: number;
    head?: string;
    replacementNumber?: number;
    supersededParentNumber?: number;
    parentReplacementNumber?: number;
    lineagePath?: string;
    help: boolean;
};
const usage =
    'usage: pnpm pr:supersede <old-pr-number> --head <40-hex-sha> --replacement <merged-pr-number> [--superseded-parent <closed-pr-number> [--parent-replacement <merged-parent-replacement-pr-number>]] --lineage <path-to-json>';

export function parseSupersedePullRequestArgs(args: string[]): SupersedePullRequestArgs {
    if (args[0] === '--help') {
        if (args.length !== 1) {
            fail('--help takes no other arguments');
        }
        return { help: true };
    }
    const carriesParentReplacement = args.length === 11;
    const carriesParent = args.length === 9 || carriesParentReplacement;
    const lineageFlagIndex = args.length - 2;
    const lineagePathIndex = args.length - 1;
    if (
        (args.length !== 7 && !carriesParent) ||
        args[1] !== '--head' ||
        args[3] !== '--replacement' ||
        (carriesParent && args[5] !== '--superseded-parent') ||
        (carriesParentReplacement && args[7] !== '--parent-replacement') ||
        args[lineageFlagIndex] !== '--lineage' ||
        args[0] === undefined ||
        args[2] === undefined ||
        args[4] === undefined ||
        args[lineagePathIndex] === undefined ||
        args[lineagePathIndex].trim() === '' ||
        !/^[1-9][0-9]*$/.test(args[0]) ||
        !/^[0-9a-f]{40}$/i.test(args[2]) ||
        !/^[1-9][0-9]*$/.test(args[4]) ||
        (carriesParent && (args[6] === undefined || !/^[1-9][0-9]*$/.test(args[6]))) ||
        (carriesParentReplacement && (args[8] === undefined || !/^[1-9][0-9]*$/.test(args[8])))
    ) {
        fail(usage);
    }
    const oldNumber = Number(args[0]);
    const replacementNumber = Number(args[4]);
    const supersededParentNumber = carriesParent ? Number(args[6]) : undefined;
    const parentReplacementNumber = carriesParentReplacement ? Number(args[8]) : undefined;
    if (
        !Number.isSafeInteger(oldNumber) ||
        !Number.isSafeInteger(replacementNumber) ||
        oldNumber === replacementNumber ||
        (supersededParentNumber !== undefined &&
            (!Number.isSafeInteger(supersededParentNumber) ||
                supersededParentNumber === oldNumber ||
                supersededParentNumber === replacementNumber)) ||
        (parentReplacementNumber !== undefined &&
            (!Number.isSafeInteger(parentReplacementNumber) ||
                parentReplacementNumber === oldNumber ||
                parentReplacementNumber === replacementNumber ||
                parentReplacementNumber === supersededParentNumber))
    ) {
        fail(usage);
    }
    return {
        oldNumber,
        head: args[2],
        replacementNumber,
        supersededParentNumber,
        parentReplacementNumber,
        lineagePath: args[lineagePathIndex],
        help: false,
    };
}

/**
 * The lineage the orchestrator wrote for this supersession, as either the rendered marker body or the
 * bare JSON object. A file that cannot be read is refused by naming it, and a file whose contents do
 * not parse as a lineage is refused by naming it and the contract problem, so a bad document never
 * reads as an absent one.
 */
export function readFindingLineageFile(path: string): FindingLineage {
    let text: string;
    try {
        text = readFileSync(path, 'utf8');
    } catch (error) {
        return fail(`cannot read finding lineage file ${path}: ${errorMessage(error)}`);
    }
    try {
        return parseFindingLineageDocument(text);
    } catch (error) {
        return fail(`finding lineage file ${path} is not a valid lineage: ${errorMessage(error)}`);
    }
}

function assertLineageBinding(lineage: FindingLineage, oldNumber: number, replacementNumber: number): void {
    if (lineage.oldPr !== oldNumber) {
        fail(`finding lineage oldPr ${lineage.oldPr} does not match old pull request ${oldNumber}`);
    }
    if (lineage.replacementPr !== replacementNumber) {
        fail(
            `finding lineage replacementPr ${lineage.replacementPr} does not match replacement pull request ${replacementNumber}`
        );
    }
}

/** The findings the old pull request carries: one per live review thread, keyed by its root comment. */
function lineageFindings(number: number, port: SupersedePullRequestPort): LineageFinding[] {
    return port.inspectReviewThreads(number).map((thread) => ({ findingId: thread.rootCommentId, pr: number }));
}

/**
 * The lineage covers the findings read before any mutation. Re-reading the live review threads
 * immediately before the close refuses when that set moved, so a thread added or removed during the
 * transaction cannot let the close record a disposition the lineage never wrote.
 */
function assertFindingsUnchanged(
    number: number,
    covered: readonly LineageFinding[],
    port: SupersedePullRequestPort
): void {
    const current = lineageFindings(number, port);
    const coveredIds = new Set(covered.map((finding) => finding.findingId));
    const currentIds = new Set(current.map((finding) => finding.findingId));
    const added = current.filter((finding) => !coveredIds.has(finding.findingId)).map((finding) => finding.findingId);
    const removed = covered.filter((finding) => !currentIds.has(finding.findingId)).map((finding) => finding.findingId);
    if (added.length === 0 && removed.length === 0) {
        return;
    }
    fail(
        `PR #${number} finding set changed after finding lineage: added ${formatFindingIds(added)}, removed ${formatFindingIds(removed)}; compensating`
    );
}

function formatFindingIds(ids: readonly string[]): string {
    return ids.length === 0 ? 'none' : ids.join(', ');
}

/** Which marker a comment must carry to be part of this transaction, and how a refusal names it. */
export type MarkerSpec = { body: string; label: string };
/** The two markers, in the order the transaction posts them: the receipt, then the lineage. */
type MarkerPair = readonly [receipt: MarkerSpec, lineage: MarkerSpec];
type CreatedMarker = { spec: MarkerSpec; id: string };
type CommentTransaction = { markers: readonly MarkerSpec[]; attempts: number; created: CreatedMarker[] };
const RECEIPT_LABEL = 'supersession comment marker';
const LINEAGE_LABEL = 'finding lineage marker';
const LINEAGE_MARKER = 'sourdaw-lineage-v1';
const SUPERSESSION_RECEIPT_PREFIX = 'Superseded by #';

type ProofMarker = Pick<IssueComment, 'id' | 'fullDatabaseId' | 'body' | 'authorNodeId' | 'authorType'>;
type PullRequestProof = Pick<
    SupersededPullRequest,
    | 'number'
    | 'state'
    | 'head'
    | 'headRefName'
    | 'headRepository'
    | 'repository'
    | 'base'
    | 'merged'
    | 'mergeCommit'
    | 'closedAt'
>;
type StackedParentProof = {
    parent: PullRequestProof;
    replacement: PullRequestProof;
    receipt: ProofMarker;
    lineage: ProofMarker;
    findingIds: string[];
    dependency?: {
        old: Omit<PullRequestProof, 'state' | 'closedAt'>;
        parentReplacement: PullRequestProof;
    };
};

function pullRequestProof(value: SupersededPullRequest): PullRequestProof {
    return {
        number: value.number,
        state: value.state,
        head: value.head,
        headRefName: value.headRefName,
        headRepository: value.headRepository,
        repository: value.repository,
        base: value.base,
        merged: value.merged,
        mergeCommit: value.mergeCommit,
        closedAt: value.closedAt,
    };
}

function oldDependencyIdentity(value: SupersededPullRequest): Omit<PullRequestProof, 'state' | 'closedAt'> {
    const { state: _state, closedAt: _closedAt, ...identity } = pullRequestProof(value);
    return identity;
}

function assertFullCommit(value: unknown, label: string): asserts value is string {
    if (typeof value !== 'string' || !/^[0-9a-f]{40}$/.test(value)) {
        fail(`${label} must be a full commit SHA`);
    }
}

function inspectDependencyProof(
    old: SupersededPullRequest,
    replacement: SupersededPullRequest,
    parent: SupersededPullRequest,
    parentReplacementNumber: number,
    port: SupersedePullRequestPort
): NonNullable<StackedParentProof['dependency']> {
    if (
        !Number.isSafeInteger(parentReplacementNumber) ||
        parentReplacementNumber <= 0 ||
        [old.number, replacement.number, parent.number].includes(parentReplacementNumber)
    ) {
        fail('parent replacement must differ from the old, replacement and parent pull requests');
    }
    const parentReplacement = port.inspect(parentReplacementNumber);
    assertReplacementIdentityAndMerge(parentReplacement, parentReplacementNumber, old);
    if (
        !replacement.merged ||
        !parentReplacement.merged ||
        replacement.base !== REQUIRED_BASE_BRANCH ||
        parentReplacement.base !== replacement.base
    ) {
        fail('distinct replacements must both be merged into main');
    }
    assertFullCommit(old.head, 'old child head');
    assertFullCommit(parent.head, 'old parent head');
    assertFullCommit(replacement.head, 'child replacement source head');
    assertFullCommit(replacement.mergeCommit, 'child replacement merge commit');
    assertFullCommit(parentReplacement.head, 'parent replacement source head');
    assertFullCommit(parentReplacement.mergeCommit, 'parent replacement merge commit');
    if (port.isAncestor?.(old.repository, parentReplacement.mergeCommit, replacement.head) !== true) {
        fail(
            `parent replacement PR #${parentReplacementNumber} merge commit is not proven in child replacement source head`
        );
    }
    return { old: oldDependencyIdentity(old), parentReplacement: pullRequestProof(parentReplacement) };
}

function proofMarker(comment: IssueComment, label: string): ProofMarker {
    if (
        comment.id === '' ||
        !isDecimalId(comment.fullDatabaseId) ||
        !isAuthorBotActor(comment.authorNodeId, comment.authorType)
    ) {
        fail(`${label} is not an exact author-bot marker`);
    }
    return {
        id: comment.id,
        fullDatabaseId: comment.fullDatabaseId,
        body: comment.body,
        authorNodeId: comment.authorNodeId,
        authorType: comment.authorType,
    };
}

function parentReceipt(parent: SupersededPullRequest, replacementNumber: number): ProofMarker {
    const candidates = parent.comments.filter((comment) => comment.body.startsWith(SUPERSESSION_RECEIPT_PREFIX));
    const expected = supersessionCommentBody(replacementNumber);
    if (candidates.length !== 1) {
        fail(`superseded parent PR #${parent.number} does not have exactly one supersession receipt`);
    }
    const [comment] = candidates;
    if (comment === undefined || comment.body !== expected) {
        fail(`superseded parent PR #${parent.number} receipt does not name replacement PR #${replacementNumber}`);
    }
    return proofMarker(comment, `superseded parent PR #${parent.number} receipt`);
}

function parentLineage(
    parent: SupersededPullRequest,
    replacementNumber: number,
    port: SupersedePullRequestPort
): { marker: ProofMarker; findingIds: string[] } {
    const candidates = parent.comments.filter((comment) =>
        comment.body.split('\n').some((line) => line.startsWith(LINEAGE_MARKER))
    );
    if (candidates.length !== 1) {
        fail(`superseded parent PR #${parent.number} does not have exactly one finding lineage marker`);
    }
    const [comment] = candidates;
    if (comment === undefined) {
        fail(`superseded parent PR #${parent.number} has no finding lineage marker`);
    }
    const marker = proofMarker(comment, `superseded parent PR #${parent.number} finding lineage marker`);
    const lineage = parseFindingLineage(comment.body);
    if (lineage === undefined || comment.body !== renderFindingLineage(lineage)) {
        fail(`superseded parent PR #${parent.number} finding lineage marker is not canonical`);
    }
    assertLineageBinding(lineage, parent.number, replacementNumber);
    const findings = lineageFindings(parent.number, port);
    assertFindingLineage(lineage, findings);
    return {
        marker,
        findingIds: findings.map((finding) => finding.findingId).sort((left, right) => left.localeCompare(right)),
    };
}

function inspectStackedParentProof(
    old: SupersededPullRequest,
    replacement: SupersededPullRequest,
    parentNumber: number,
    port: SupersedePullRequestPort,
    parentReplacementNumber?: number
): StackedParentProof {
    if (
        !Number.isSafeInteger(parentNumber) ||
        parentNumber <= 0 ||
        parentNumber === old.number ||
        parentNumber === replacement.number
    ) {
        fail('superseded parent pull request must differ from the old and replacement pull requests');
    }
    const parent = port.inspect(parentNumber);
    if (
        parent.number !== parentNumber ||
        parent.repository !== REQUIRED_REPOSITORY ||
        parent.repository !== old.repository ||
        parent.repository !== replacement.repository
    ) {
        fail(`superseded parent PR #${parentNumber} is not in the required repository`);
    }
    if (parent.state !== PR_STATE.CLOSED || parent.merged || parent.closedAt === null || parent.closedAt === '') {
        fail(`superseded parent PR #${parentNumber} is not closed without merge`);
    }
    if (parent.headRefName !== old.base) {
        fail(`superseded parent PR #${parentNumber} does not own old base ${old.base}`);
    }
    if (parent.headRepository !== old.repository) {
        fail(
            `superseded parent PR #${parentNumber} head repository does not match child base repository ${old.repository}`
        );
    }
    if (parent.base !== replacement.base) {
        fail(`superseded parent PR #${parentNumber} does not target replacement base ${replacement.base}`);
    }
    let dependency: StackedParentProof['dependency'];
    if (parentReplacementNumber !== undefined) {
        dependency = inspectDependencyProof(old, replacement, parent, parentReplacementNumber, port);
    }
    const parentSuccessor = parentReplacementNumber ?? replacement.number;
    const receipt = parentReceipt(parent, parentSuccessor);
    const lineage = parentLineage(parent, parentSuccessor, port);
    return {
        parent: pullRequestProof(parent),
        replacement: pullRequestProof(replacement),
        receipt,
        lineage: lineage.marker,
        findingIds: lineage.findingIds,
        dependency,
    };
}

function assertStackedParentProofUnchanged(
    initial: StackedParentProof,
    old: SupersededPullRequest,
    port: SupersedePullRequestPort
): void {
    const replacement = port.inspect(initial.replacement.number);
    assertReplacementIdentityAndMerge(replacement, initial.replacement.number, old);
    const current = inspectStackedParentProof(
        old,
        replacement,
        initial.parent.number,
        port,
        initial.dependency?.parentReplacement.number
    );
    if (JSON.stringify(current) !== JSON.stringify(initial)) {
        fail(`superseded parent PR #${initial.parent.number} proof changed during supersession; compensating`);
    }
}

export function supersedePullRequest(
    oldNumber: number,
    expectedHead: string,
    replacementNumber: number,
    lineage: FindingLineage,
    authorNodeId: string,
    port: SupersedePullRequestPort,
    supersededParentNumber?: number,
    parentReplacementNumber?: number
): string {
    if (!isAuthorBotNodeId(authorNodeId)) {
        fail(`authenticated author actor ${authorNodeId} is not ${AUTHOR_BOT_NODE_ID}`);
    }
    if (oldNumber === replacementNumber) {
        fail('replacement pull request must differ from the old pull request');
    }
    assertLineageBinding(lineage, oldNumber, replacementNumber);
    const coveredFindings = lineageFindings(oldNumber, port);
    assertFindingLineage(lineage, coveredFindings);
    const before = port.inspect(oldNumber);
    const replacement = port.inspect(replacementNumber);
    assertOldBinding(before, oldNumber, expectedHead);
    const stackedParentProof = assertReplacement(
        replacement,
        replacementNumber,
        before,
        supersededParentNumber,
        port,
        parentReplacementNumber
    );
    const markers: MarkerPair = [
        { body: supersessionCommentBody(replacementNumber), label: RECEIPT_LABEL },
        { body: renderFindingLineage(lineage), label: LINEAGE_LABEL },
    ];
    if (before.state === PR_STATE.CLOSED) {
        assertCompletedSupersession(before, oldNumber, expectedHead, before.base, markers);
        return logSupersessionSuccess(oldNumber, replacementNumber, port);
    }
    assertOpen(before, oldNumber);
    closePullRequestWithMarkers(oldNumber, expectedHead, before, markers, port, {
        beforeMarkers: () => {
            if (stackedParentProof !== undefined) {
                const current = stackedParentProof.dependency === undefined ? before : port.inspect(oldNumber);
                if (stackedParentProof.dependency !== undefined) {
                    assertStableOpen(current, oldNumber, expectedHead, before.base);
                    assertFindingsUnchanged(oldNumber, coveredFindings, port);
                }
                assertStackedParentProofUnchanged(stackedParentProof, current, port);
            }
        },
        beforeClose: () => {
            assertFindingsUnchanged(oldNumber, coveredFindings, port);
            if (stackedParentProof !== undefined) {
                const current = stackedParentProof.dependency === undefined ? before : port.inspect(oldNumber);
                if (stackedParentProof.dependency !== undefined) {
                    assertStableOpen(current, oldNumber, expectedHead, before.base);
                }
                assertStackedParentProofUnchanged(stackedParentProof, current, port);
            }
        },
        afterClose: (verified, markerIds, closeReceipt) => {
            try {
                assertFinalSupersession(
                    verified,
                    oldNumber,
                    expectedHead,
                    before.base,
                    markers,
                    markerIds[0]!,
                    markerIds[1]!,
                    closeReceipt
                );
                if (stackedParentProof !== undefined) {
                    if (stackedParentProof.dependency !== undefined) {
                        assertFindingsUnchanged(oldNumber, coveredFindings, port);
                    }
                    assertStackedParentProofUnchanged(stackedParentProof, verified, port);
                }
            } catch (error) {
                if (stackedParentProof !== undefined) {
                    fail(
                        `stacked supersession authority is ambiguous after closing PR #${oldNumber}: ${errorMessage(error)}`
                    );
                }
                throw error;
            }
        },
    });
    return logSupersessionSuccess(oldNumber, replacementNumber, port);
}

export function closePullRequestWithMarkers(
    number: number,
    expectedHead: string,
    before: SupersededPullRequest,
    markers: readonly MarkerSpec[],
    port: SupersedePullRequestPort,
    checks: {
        beforeMarkers?: () => void;
        beforeClose: () => void;
        afterClose: (verified: SupersededPullRequest, markerIds: string[], receipt: PullRequestCloseReceipt) => void;
    }
): void {
    if (markers.length === 0) {
        fail('closure requires at least one public marker');
    }
    const transaction: CommentTransaction = { markers, attempts: 0, created: [] };
    let closeAttempted = false;
    let closeReceipt: PullRequestCloseReceipt | undefined;
    try {
        checks.beforeMarkers?.();
        for (const marker of markers) {
            ensureMarker(number, marker, before.comments, transaction, port);
        }
        const afterMarkers = port.inspect(number);
        assertStableOpen(afterMarkers, number, expectedHead, before.base);
        for (const marker of markers) {
            convergeCommentMarkers(number, marker, afterMarkers, markers, port);
        }
        const converged = port.inspect(number);
        assertStableOpen(converged, number, expectedHead, before.base);
        const markerIds = markers.map(
            (marker) => requireOneCommentMarker(converged.comments, marker, markers, number).id
        );
        checks.beforeClose();
        closeAttempted = true;
        const closeResult = port.close(number);
        assertCloseReceipt(closeResult);
        closeReceipt = closeResult;
        const verified = port.inspect(number);
        checks.afterClose(verified, markerIds, closeReceipt);
    } catch (error) {
        compensateSupersession(number, before, transaction, closeAttempted, closeReceipt, port, error);
    }
}

function logSupersessionSuccess(oldNumber: number, replacementNumber: number, port: SupersedePullRequestPort): string {
    const success = `pull-request-superseded:${oldNumber}:${replacementNumber}`;
    port.log(success);
    return success;
}

/** Posts `spec` unless the pull request already carries it, recording the attempt before the write. */
function ensureMarker(
    number: number,
    spec: MarkerSpec,
    comments: IssueComment[],
    transaction: CommentTransaction,
    port: SupersedePullRequestPort
): void {
    if (findReusableComment(comments, spec, transaction.markers) !== undefined) {
        return;
    }
    transaction.attempts += 1;
    const added = port.comment(number, spec.body);
    const id = assertCommentReceipt(added, commentClientMutationId(number, spec.body));
    assertCommentBody(added, spec.body);
    transaction.created.push({ spec, id });
}

function compensateSupersession(
    number: number,
    before: SupersededPullRequest,
    transaction: CommentTransaction,
    closeAttempted: boolean,
    closeReceipt: PullRequestCloseReceipt | undefined,
    port: SupersedePullRequestPort,
    original: unknown
): never {
    const failures: string[] = [];
    let current: SupersededPullRequest | undefined;
    attempt(failures, 'inspect ambiguous supersession transaction', () => {
        current = port.inspect(number);
    });
    if (current === undefined) {
        failures.push('cannot determine ambiguous supersession transaction state');
    } else {
        const stateMayHaveMutated = closeReceipt !== undefined || closeAttempted;
        const unverified = transaction.attempts > transaction.created.length;
        if (stateMayHaveMutated) {
            failures.push('pull-request closure was attempted; preserving supersession markers as durable evidence');
        }
        if (!closeAttempted && current.state === PR_STATE.CLOSED && transaction.created.length > 0) {
            deleteCreatedNoncanonicalComments(current.comments, transaction, port, failures);
        } else if (unverified) {
            failures.push('ambiguous supersession comment mutation; refusing to delete an unverified comment');
        } else if (transaction.created.length > 0 && !stateMayHaveMutated && current.state === before.state) {
            deleteCreatedComments(current.comments, transaction, port, failures);
        }
    }
    if (current !== undefined && current.state === before.state && closeReceipt === undefined) {
        attempt(failures, 'verify supersession compensation', () => {
            const verified = port.inspect(number);
            if (verified.state !== before.state || !sameCommentIds(verified.comments, before.comments)) {
                fail(`PR #${number} compensation was not verified`);
            }
        });
    }
    throwWithCompensation(original, failures);
}
function sameCommentIds(left: IssueComment[], right: IssueComment[]): boolean {
    if (left.length !== right.length) {
        return false;
    }
    const ids = new Set(left.map((comment) => comment.id));
    return ids.size === right.length && right.every((comment) => ids.has(comment.id));
}
function throwWithCompensation(original: unknown, failures: string[]): never {
    const message = errorMessage(original);
    if (failures.length > 0) {
        throw new Error(`${message}; compensation failed: ${failures.join('; ')}`, { cause: original });
    }
    if (original instanceof Error) {
        throw original;
    }
    throw new Error(message);
}
function attempt(failures: string[], label: string, operation: () => void): void {
    try {
        operation();
    } catch (error) {
        failures.push(`${label}: ${errorMessage(error)}`);
    }
}
function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
function assertOldBinding(value: SupersededPullRequest, number: number, head: string): void {
    if (value.number !== number || value.repository !== REQUIRED_REPOSITORY) {
        fail(`cannot inspect PR #${number} in ${REQUIRED_REPOSITORY}`);
    }
    if (value.head !== head) {
        fail('supplied head does not match the current pull-request head');
    }
}
function assertOpen(value: SupersededPullRequest, number: number): void {
    if (value.state !== PR_STATE.OPEN) {
        fail(`PR #${number} is ${value.state.toLowerCase()}`);
    }
}
function assertReplacementIdentityAndMerge(
    value: SupersededPullRequest,
    number: number,
    old: SupersededPullRequest
): void {
    if (value.number !== number || value.repository !== REQUIRED_REPOSITORY || value.repository !== old.repository) {
        fail(`replacement PR #${number} is not in the required repository`);
    }
    if (value.state !== PR_STATE.MERGED) {
        fail(`replacement PR #${number} is not merged`);
    }
}
function assertReplacement(
    value: SupersededPullRequest,
    number: number,
    old: SupersededPullRequest,
    supersededParentNumber: number | undefined,
    port: SupersedePullRequestPort,
    parentReplacementNumber?: number
): StackedParentProof | undefined {
    assertReplacementIdentityAndMerge(value, number, old);
    if (value.base === old.base) {
        if (parentReplacementNumber !== undefined) {
            fail('parent replacement requires a cross-base superseded parent');
        }
        return undefined;
    }
    if (supersededParentNumber === undefined) {
        fail(`replacement PR #${number} does not target ${old.base}`);
    }
    return inspectStackedParentProof(old, value, supersededParentNumber, port, parentReplacementNumber);
}
function assertStableOpen(value: SupersededPullRequest, number: number, head: string, base: string): void {
    if (
        value.number !== number ||
        value.repository !== REQUIRED_REPOSITORY ||
        value.state !== PR_STATE.OPEN ||
        value.base !== base
    ) {
        fail(`PR #${number} changed after supersession comment; compensating`);
    }
    if (value.head !== head) {
        fail('pull-request head moved after mutation; compensating');
    }
}
function assertCloseReceipt(receipt: PullRequestCloseReceipt): void {
    if (typeof receipt.closedAt !== 'string' || receipt.closedAt === '') {
        fail('closePullRequest returned an invalid result');
    }
}
function isAuthorBotActor(nodeId: unknown, type: unknown): boolean {
    return type === 'Bot' && typeof nodeId === 'string' && isAuthorBotNodeId(nodeId);
}
function hasExpectedComment(comments: IssueComment[], id: string, body: string): boolean {
    return comments.some(
        (comment) =>
            comment.id === id && comment.body === body && isAuthorBotActor(comment.authorNodeId, comment.authorType)
    );
}
/**
 * Every author-bot comment this transaction owns, held to one of the two marker bodies. A comment by
 * the author bot carrying anything else is not a marker this command wrote, so the transaction
 * refuses rather than reading it as a duplicate to delete.
 */
function validatedCommentMarkers(comments: IssueComment[], markers: readonly MarkerSpec[]): IssueComment[] {
    const bodies = new Set(markers.map((marker) => marker.body));
    const owned = comments.filter((comment) => isAuthorBotNodeId(comment.authorNodeId));
    for (const comment of owned) {
        if (
            !isDecimalId(comment.fullDatabaseId) ||
            !bodies.has(comment.body) ||
            !isAuthorBotActor(comment.authorNodeId, comment.authorType)
        ) {
            fail('owned supersession marker is not an exact author-bot receipt');
        }
    }
    return owned.sort(compareMarkers);
}
function compareMarkers(left: IssueComment, right: IssueComment): number {
    // The smallest decimal fullDatabaseId, then node ID, is the canonical concurrent marker.
    const difference = BigInt(left.fullDatabaseId) - BigInt(right.fullDatabaseId);
    if (difference === 0n) {
        return left.id.localeCompare(right.id);
    }
    return difference < 0n ? -1 : 1;
}
function markerComments(comments: IssueComment[], spec: MarkerSpec, markers: readonly MarkerSpec[]): IssueComment[] {
    return validatedCommentMarkers(comments, markers).filter((comment) => comment.body === spec.body);
}
function requireOneCommentMarker(
    comments: IssueComment[],
    spec: MarkerSpec,
    markers: readonly MarkerSpec[],
    number: number
): IssueComment {
    const matches = markerComments(comments, spec, markers);
    const [marker] = matches;
    if (marker === undefined || matches.length !== 1) {
        fail(`PR #${number} does not have exactly one valid ${spec.label}`);
    }
    return marker;
}
function requireOneOrMoreCommentMarker(
    comments: IssueComment[],
    spec: MarkerSpec,
    markers: readonly MarkerSpec[],
    number: number
): IssueComment {
    const [marker] = markerComments(comments, spec, markers);
    if (marker === undefined) {
        fail(`PR #${number} has no valid ${spec.label}`);
    }
    return marker;
}
function convergeCommentMarkers(
    number: number,
    spec: MarkerSpec,
    value: SupersededPullRequest,
    markers: readonly MarkerSpec[],
    port: SupersedePullRequestPort
): void {
    const canonical = requireOneOrMoreCommentMarker(value.comments, spec, markers, number);
    for (const marker of markerComments(value.comments, spec, markers)) {
        if (marker.id !== canonical.id) {
            port.deleteComment(marker.id);
        }
    }
}
/** Deletes this invocation's noncanonical markers once another invocation has closed the pull request. */
function deleteCreatedNoncanonicalComments(
    comments: IssueComment[],
    transaction: CommentTransaction,
    port: SupersedePullRequestPort,
    failures: string[]
): void {
    for (const created of transaction.created) {
        let canonical: IssueComment;
        try {
            canonical = requireOneOrMoreCommentMarker(comments, created.spec, transaction.markers, 0);
        } catch (error) {
            failures.push(`inspect concurrent supersession markers: ${errorMessage(error)}`);
            return;
        }
        if (canonical.id === created.id || !hasExpectedComment(comments, created.id, created.spec.body)) {
            failures.push("concurrent closure retained this invocation's canonical or unverified supersession comment");
            return;
        }
        attempt(failures, 'delete noncanonical supersession comment', () => port.deleteComment(created.id));
    }
}
/** Rolls this invocation's verified markers back, refusing as a whole when any of them was altered. */
function deleteCreatedComments(
    comments: IssueComment[],
    transaction: CommentTransaction,
    port: SupersedePullRequestPort,
    failures: string[]
): void {
    const altered = transaction.created.filter(
        (created) =>
            comments.some((comment) => comment.id === created.id) &&
            !hasExpectedComment(comments, created.id, created.spec.body)
    );
    if (altered.length > 0) {
        failures.push(`${altered.length} created supersession marker(s) are no longer exact; refusing to roll back`);
        return;
    }
    for (const created of transaction.created) {
        if (hasExpectedComment(comments, created.id, created.spec.body)) {
            attempt(failures, 'delete supersession comment', () => port.deleteComment(created.id));
        }
    }
}
function findReusableComment(
    comments: IssueComment[],
    spec: MarkerSpec,
    markers: readonly MarkerSpec[]
): IssueComment | undefined {
    return markerComments(comments, spec, markers)[0];
}
function assertFinalSupersession(
    value: SupersededPullRequest,
    number: number,
    head: string,
    base: string,
    markers: MarkerPair,
    receiptId: string,
    lineageId: string,
    closeReceipt: PullRequestCloseReceipt
): void {
    if (value.number !== number || value.repository !== REQUIRED_REPOSITORY || value.head !== head) {
        fail('pull-request head moved after mutation; compensating');
    }
    if (value.base !== base) {
        fail('pull-request base changed after mutation; compensating');
    }
    if (value.state !== PR_STATE.CLOSED || value.closedAt !== closeReceipt.closedAt) {
        fail(`PR #${number} was closed by another actor`);
    }
    if (!hasExpectedComment(value.comments, receiptId, markers[0].body)) {
        fail(`supersession comment receipt ${receiptId} is not present on PR #${number}`);
    }
    if (!hasExpectedComment(value.comments, lineageId, markers[1].body)) {
        fail(`finding lineage marker ${lineageId} is not present on PR #${number}`);
    }
    for (const marker of markers) {
        requireOneCommentMarker(value.comments, marker, markers, number);
    }
}
function assertCompletedSupersession(
    value: SupersededPullRequest,
    number: number,
    head: string,
    base: string,
    markers: MarkerPair
): void {
    assertCompletedClosureWithMarkers(value, number, head, base, markers);
}

export function assertCompletedClosureWithMarkers(
    value: SupersededPullRequest,
    number: number,
    head: string,
    base: string,
    markers: readonly MarkerSpec[]
): void {
    if (
        value.number !== number ||
        value.repository !== REQUIRED_REPOSITORY ||
        value.head !== head ||
        value.base !== base ||
        value.state !== PR_STATE.CLOSED
    ) {
        fail(`PR #${number} is not the expected completed supersession`);
    }
    for (const marker of markers) {
        requireOneCommentMarker(value.comments, marker, markers, number);
    }
}
function assertCommentReceipt(value: AddedIssueCommentReceipt, expectedClientMutationId: string): string {
    if (
        typeof value.id !== 'string' ||
        value.id === '' ||
        !isDecimalId(value.fullDatabaseId) ||
        !isAuthorBotActor(value.authorNodeId, value.authorType) ||
        value.clientMutationId !== expectedClientMutationId
    ) {
        fail('add supersession comment returned an invalid result');
    }
    return value.id;
}
function assertCommentBody(value: IssueComment, expectedBody: string): void {
    if (value.body !== expectedBody) {
        fail('add supersession comment returned an invalid result');
    }
}

async function main(): Promise<number> {
    const parsed = parseSupersedePullRequestArgs(process.argv.slice(2));
    if (parsed.help) {
        console.log(`Usage: ${usage.slice('usage: '.length)}`);
        return 0;
    }
    if (
        parsed.oldNumber === undefined ||
        parsed.head === undefined ||
        parsed.replacementNumber === undefined ||
        parsed.lineagePath === undefined
    ) {
        fail(usage);
    }
    const cwd = process.cwd();
    assertTrustedExecutingBlob(
        'scripts/supersedePullRequest.ts',
        fileURLToPath(import.meta.url),
        originMainBlob('scripts/supersedePullRequest.ts', cwd)
    );
    const primaryRoot = resolvePrimaryRoot();
    const auth = await authenticateRole({ primaryRoot, role: 'author' });
    try {
        if (!isAuthorBotNodeId(auth.minted.actorNodeId)) {
            fail(`minted actor ${auth.minted.actorNodeId} is not ${AUTHOR_BOT_NODE_ID}`);
        }
        assertRequiredRepository(
            spawnCapture('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], {
                env: auth.session.env,
                cwd: primaryRoot,
            })
        );
        const lineage = readFindingLineageFile(parsed.lineagePath);
        supersedePullRequest(
            parsed.oldNumber,
            parsed.head,
            parsed.replacementNumber,
            lineage,
            auth.minted.actorNodeId,
            shellPort(auth.session),
            parsed.supersededParentNumber,
            parsed.parentReplacementNumber
        );
        return 0;
    } finally {
        auth.session.dispose();
    }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    void main().then(
        (code) => process.exit(code),
        (error: unknown) => {
            console.error(error instanceof Error ? error.message : error);
            process.exit(1);
        }
    );
}
