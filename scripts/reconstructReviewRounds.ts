#!/usr/bin/env node
/**
 * Cold-checkout reconstruction of a pull request's review rounds (#3375, spec #3367 AC-004).
 *
 * Everything this command reads is a public channel: the pull request's reviews, its review
 * comments, and the `sourdaw-repair-v1` marker lines in thread replies. From those alone it
 * rebuilds every governed round — the reviewer App's verdicts and the orchestrator's acceptance,
 * each bound to the exact head it reviewed, with each blocking comment and its recorded repairs —
 * without touching a local review bundle.
 *
 * When a local bundle does carry the head's dossier, the reconstruction is shadow-compared against
 * it: the recorded publication id, recommendation, and every finding's public comment binding must
 * match the public record one-to-one. Mismatches are reported and counted, never enforced — this
 * command is the shadow lane whose observations calibrate the enforcement #3377 cuts over, so it
 * writes nothing and its exit code answers only whether the public record was readable.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    ORCHESTRATOR_USER_NODE_ID,
    REQUIRED_REPOSITORY,
    REVIEWER_BOT_NODE_ID,
    parseJson,
    resolvePrimaryRoot,
    spawnCapture,
} from './githubAppIdentity.ts';
import { fail } from './prContract.ts';
import { reviewBundlePath } from './prepareReview.ts';
import { parseReviewDossier } from './reviewDossier.ts';
import { acceptedFindings, publishedFindings, publishedReviewId } from './reviewDossierViews.ts';
import { parseReviewRepairReply, type ReviewRepairRecord } from './reviewRepair.ts';

export const REVIEW_RECONSTRUCT_USAGE = 'usage: pnpm review:reconstruct <pr-number>';

export type PublicReview = {
    id: number;
    state: string;
    commitId: string;
    actorNodeId: string;
    body: string;
};

export type PublicReviewComment = {
    id: number;
    reviewId: number;
    path: string;
    line: number;
    side: 'LEFT' | 'RIGHT';
    body: string;
    inReplyToId?: number;
};

export type ReconstructedFinding = {
    commentId: number;
    path: string;
    line: number;
    side: 'LEFT' | 'RIGHT';
    repairs: ReviewRepairRecord[];
};

export type ReconstructedRound = {
    headSha: string;
    reviewId: number;
    role: 'reviewer' | 'orchestrator';
    verdict: 'approved' | 'changes-requested';
    findings: ReconstructedFinding[];
};

export type ReviewReconstruction = {
    pr: number;
    head: string;
    rounds: ReconstructedRound[];
};

export type ReconstructReviewRoundsPort = {
    pullRequest: (number: number) => { state: string; head: string };
    reviews: (number: number) => PublicReview[];
    reviewComments: (number: number) => PublicReviewComment[];
    /** The local bundle's dossier for one head, or undefined when the bundle carries none. */
    localDossier: (number: number, head: string) => unknown;
    log: (message: string) => void;
};

export type ShadowComparison = { head: string; mismatches: string[] };

const VERDICT_BY_STATE: ReadonlyMap<string, ReconstructedRound['verdict']> = new Map([
    ['APPROVED', 'approved'],
    ['CHANGES_REQUESTED', 'changes-requested'],
]);

function roleOf(actorNodeId: string): ReconstructedRound['role'] | undefined {
    if (actorNodeId === REVIEWER_BOT_NODE_ID) {
        return 'reviewer';
    }
    if (actorNodeId === ORCHESTRATOR_USER_NODE_ID) {
        return 'orchestrator';
    }
    return undefined;
}

/**
 * The governed rounds, oldest review first. Reviews from any other actor, and reviews that carry
 * no verdict (plain comments), are not rounds in the three-entity choreography and are skipped.
 * A reply comment is repair evidence for its root finding, never a finding of its own.
 */
export function reconstructReviewRounds(
    number: number,
    pullRequest: { state: string; head: string },
    reviews: readonly PublicReview[],
    comments: readonly PublicReviewComment[]
): ReviewReconstruction {
    const roots = new Map<number, PublicReviewComment>();
    for (const comment of comments) {
        if (comment.inReplyToId === undefined) {
            roots.set(comment.id, comment);
        }
    }
    const repairsByRoot = new Map<number, ReviewRepairRecord[]>();
    for (const comment of comments) {
        if (comment.inReplyToId === undefined) {
            continue;
        }
        const repair = parseReviewRepairReply(comment.body);
        if (repair === undefined) {
            continue;
        }
        if (!roots.has(comment.inReplyToId)) {
            fail(`review reconstruction: repair reply ${comment.id} answers an unknown root comment`);
        }
        const list = repairsByRoot.get(comment.inReplyToId) ?? [];
        list.push(repair);
        repairsByRoot.set(comment.inReplyToId, list);
    }
    const findingsByReview = new Map<number, PublicReviewComment[]>();
    for (const comment of roots.values()) {
        const list = findingsByReview.get(comment.reviewId) ?? [];
        list.push(comment);
        findingsByReview.set(comment.reviewId, list);
    }
    const rounds: ReconstructedRound[] = [];
    for (const review of [...reviews].sort((a, b) => a.id - b.id)) {
        const role = roleOf(review.actorNodeId);
        const verdict = VERDICT_BY_STATE.get(review.state);
        if (role === undefined || verdict === undefined) {
            continue;
        }
        const findings = (findingsByReview.get(review.id) ?? []).map((comment) => ({
            commentId: comment.id,
            path: comment.path,
            line: comment.line,
            side: comment.side,
            repairs: repairsByRoot.get(comment.id) ?? [],
        }));
        rounds.push({ headSha: review.commitId, reviewId: review.id, role, verdict, findings });
    }
    return { pr: number, head: pullRequest.head, rounds };
}

/**
 * One head's dossier against the public rounds: every accepted finding must bind the public
 * comment the dossier says it became, positionally and by id, on the recorded review — and that
 * review must stand in the reconstruction with the recorded verdict. Returns one line per
 * mismatch; an empty list means the public record and the durable record agree exactly.
 */
export function shadowCompareDossier(
    reconstruction: ReviewReconstruction,
    head: string,
    dossierValue: unknown
): ShadowComparison {
    const mismatches: string[] = [];
    const dossier = parseReviewDossier(dossierValue);
    if (dossier.pr !== reconstruction.pr) {
        mismatches.push(`dossier pr ${dossier.pr} is not the reconstructed pull request ${reconstruction.pr}`);
    }
    if (dossier.headSha !== head) {
        mismatches.push(`dossier headSha ${dossier.headSha} is not the compared head ${head}`);
    }
    const recorded = publishedReviewId(dossier);
    if (recorded === undefined) {
        mismatches.push('dossier records no publication');
        return { head, mismatches };
    }
    const round = reconstruction.rounds.find(
        (candidate) => candidate.headSha === head && candidate.reviewId === recorded
    );
    if (round === undefined) {
        mismatches.push(`recorded publication ${recorded} stands in no public round on head ${head}`);
        return { head, mismatches };
    }
    const recommendation = round.verdict === 'approved' ? 'approve' : 'request-changes';
    if (dossier.recommendation !== recommendation) {
        mismatches.push(`dossier recommendation ${dossier.recommendation} disagrees with the public ${round.verdict}`);
    }
    const accepted = acceptedFindings(dossier);
    const published = new Map(publishedFindings(dossier).map((finding) => [finding.findingId, finding]));
    if (accepted.length !== round.findings.length) {
        mismatches.push(
            `dossier accepts ${accepted.length} findings but the public review carries ${round.findings.length} comments`
        );
    }
    for (const [index, finding] of accepted.entries()) {
        const binding = published.get(finding.findingId);
        if (binding === undefined) {
            mismatches.push(`accepted finding ${finding.findingId} binds no public comment`);
            continue;
        }
        if (binding.reviewId !== recorded) {
            mismatches.push(`finding ${finding.findingId} binds review ${binding.reviewId}, not ${recorded}`);
        }
        const comment = round.findings[index];
        if (comment === undefined) {
            continue;
        }
        if (binding.commentId !== comment.commentId) {
            mismatches.push(
                `finding ${finding.findingId} binds comment ${binding.commentId}, but the public order gives ${comment.commentId}`
            );
        }
        if (finding.path !== comment.path || finding.line !== comment.line || finding.side !== comment.side) {
            mismatches.push(
                `finding ${finding.findingId} targets ${finding.path}:${finding.line}:${finding.side}, publicly ${comment.path}:${comment.line}:${comment.side}`
            );
        }
    }
    return { head, mismatches };
}

export type ReconstructionRun = {
    reconstruction: ReviewReconstruction;
    comparisons: ShadowComparison[];
    mismatches: number;
};

/**
 * Rebuild the rounds, then shadow-compare every head whose local bundle carries a dossier. The
 * run logs one line per round and per mismatch and a single summary line; it refuses unreadable
 * public data but never a mismatch — shadow mode observes, it does not gate.
 */
export function runReviewReconstruction(number: number, port: ReconstructReviewRoundsPort): ReconstructionRun {
    const pullRequest = port.pullRequest(number);
    const reconstruction = reconstructReviewRounds(
        number,
        pullRequest,
        port.reviews(number),
        port.reviewComments(number)
    );
    for (const round of reconstruction.rounds) {
        port.log(
            `round: head ${round.headSha} review ${round.reviewId} ${round.role} ${round.verdict} findings ${round.findings.length}`
        );
    }
    const comparisons: ShadowComparison[] = [];
    let mismatches = 0;
    const heads = [...new Set(reconstruction.rounds.map((round) => round.headSha))];
    for (const head of heads) {
        const dossier = port.localDossier(number, head);
        if (dossier === undefined) {
            continue;
        }
        const comparison = shadowCompareDossier(reconstruction, head, dossier);
        comparisons.push(comparison);
        for (const mismatch of comparison.mismatches) {
            port.log(`shadow mismatch on ${head}: ${mismatch}`);
        }
        mismatches += comparison.mismatches.length;
    }
    port.log(
        `review-reconstruction:${number}:rounds=${reconstruction.rounds.length}:compared=${comparisons.length}:mismatches=${mismatches}`
    );
    return { reconstruction, comparisons, mismatches };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asSafeInteger(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined;
}

function flattenedGhPages(value: unknown, label: string): unknown[] {
    if (!Array.isArray(value)) {
        fail(`${label} are unreadable`);
    }
    if (value.every((page) => Array.isArray(page))) {
        return value.flat();
    }
    if (value.every((entry) => !Array.isArray(entry))) {
        return value;
    }
    return fail(`${label} are unreadable`);
}

function readPublicReviews(gh: (args: string[]) => string, number: number): PublicReview[] {
    const pages = flattenedGhPages(
        parseJson<unknown>(
            gh(['api', '--paginate', '--slurp', `repos/${REQUIRED_REPOSITORY}/pulls/${number}/reviews?per_page=100`]),
            'review reconstruction reviews'
        ),
        'review reconstruction reviews'
    );
    const reviews: PublicReview[] = [];
    for (const entry of pages) {
        if (!isRecord(entry)) {
            fail('review reconstruction review is unreadable');
        }
        const id = asSafeInteger(entry.id);
        if (
            id === undefined ||
            typeof entry.state !== 'string' ||
            typeof entry.body !== 'string' ||
            typeof entry.commit_id !== 'string' ||
            !isRecord(entry.user) ||
            typeof entry.user.node_id !== 'string'
        ) {
            fail('review reconstruction review is unreadable');
        }
        reviews.push({
            id,
            state: entry.state,
            body: entry.body,
            commitId: entry.commit_id,
            actorNodeId: entry.user.node_id,
        });
    }
    return reviews;
}

function readPublicReviewComments(gh: (args: string[]) => string, number: number): PublicReviewComment[] {
    const pages = flattenedGhPages(
        parseJson<unknown>(
            gh(['api', '--paginate', '--slurp', `repos/${REQUIRED_REPOSITORY}/pulls/${number}/comments?per_page=100`]),
            'review reconstruction comments'
        ),
        'review reconstruction comments'
    );
    const comments: PublicReviewComment[] = [];
    for (const entry of pages) {
        if (!isRecord(entry)) {
            fail('review reconstruction comment is unreadable');
        }
        const id = asSafeInteger(entry.id);
        const reviewId = asSafeInteger(entry.pull_request_review_id);
        const line = asSafeInteger(entry.original_line);
        if (
            id === undefined ||
            reviewId === undefined ||
            line === undefined ||
            typeof entry.path !== 'string' ||
            (entry.side !== 'LEFT' && entry.side !== 'RIGHT') ||
            typeof entry.body !== 'string'
        ) {
            fail('review reconstruction comment is unreadable');
        }
        const comment: PublicReviewComment = {
            id,
            reviewId,
            path: entry.path,
            line,
            side: entry.side,
            body: entry.body,
        };
        const inReplyToId = asSafeInteger(entry.in_reply_to_id);
        if (inReplyToId !== undefined) {
            comment.inReplyToId = inReplyToId;
        }
        comments.push(comment);
    }
    return comments;
}

export function shellReconstructionPort(
    cwd: string = process.cwd(),
    capture: typeof spawnCapture = spawnCapture
): ReconstructReviewRoundsPort {
    const primaryRoot = resolvePrimaryRoot(
        (command, args, directory) => capture(command, args, { cwd: directory }),
        cwd
    );
    const gh = (args: string[]) => capture('gh', args, { cwd: primaryRoot });
    return {
        pullRequest: (number) => {
            const pullRequest = parseJson<{ state?: unknown; headRefOid?: unknown }>(
                gh(['pr', 'view', String(number), '--repo', REQUIRED_REPOSITORY, '--json', 'state,headRefOid']),
                'review reconstruction pull request'
            );
            if (typeof pullRequest.state !== 'string' || typeof pullRequest.headRefOid !== 'string') {
                fail('review reconstruction pull request is unreadable');
            }
            return { state: pullRequest.state, head: pullRequest.headRefOid };
        },
        reviews: (number) => readPublicReviews(gh, number),
        reviewComments: (number) => readPublicReviewComments(gh, number),
        localDossier: (number, head) => {
            const path = join(reviewBundlePath(primaryRoot, number, head), 'dossier.json');
            if (!existsSync(path)) {
                return undefined;
            }
            return parseJson<unknown>(readFileSync(path, 'utf8'), `review dossier at ${path}`);
        },
        log: (message) => {
            console.log(message);
        },
    };
}

export function runReconstructReviewRoundsCli(
    args: string[],
    port: ReconstructReviewRoundsPort = shellReconstructionPort()
): number {
    if (args[0] === '--help') {
        if (args.length !== 1) {
            fail('--help takes no other arguments');
        }
        console.log(`Usage: ${REVIEW_RECONSTRUCT_USAGE.slice('usage: '.length)}`);
        return 0;
    }
    const value = Number(args[0]);
    if (!Number.isSafeInteger(value) || value <= 0 || args.length !== 1) {
        fail(REVIEW_RECONSTRUCT_USAGE);
    }
    runReviewReconstruction(value, port);
    return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    try {
        process.exit(runReconstructReviewRoundsCli(process.argv.slice(2)));
    } catch (error: unknown) {
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
    }
}
