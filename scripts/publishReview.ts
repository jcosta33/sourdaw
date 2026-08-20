#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    REQUIRED_REPOSITORY,
    REVIEWER_BOT_LOGIN,
    assertRequiredRepository,
    assertTrustedExecutingBlob,
    authenticateRole,
    originMainBlob,
    parseJson,
    resolvePrimaryRoot,
    spawnCapture,
    type GhSession,
} from './githubAppIdentity.ts';
import { assertReviewCommentBody, fail } from './prContract.ts';
import { reviewBundlePath } from './prepareReview.ts';

export type ReviewEvent = 'APPROVE' | 'REQUEST_CHANGES';

/**
 * GitHub's review-creation request and the review it hands back use two different vocabularies:
 * the request says `APPROVE` / `REQUEST_CHANGES` / `COMMENT`, the response says `APPROVED` /
 * `CHANGES_REQUESTED` / `COMMENTED`. GitHub can also silently coerce the requested event — most
 * observed when the PR closed or merged between bundle prep and posting — and return 200 with a
 * review whose recorded state does not match what was asked for. Map the two vocabularies
 * explicitly rather than by string coincidence, so a coercion is never mistaken for success.
 */
export const EXPECTED_REVIEW_STATE: Record<ReviewEvent, string> = {
    APPROVE: 'APPROVED',
    REQUEST_CHANGES: 'CHANGES_REQUESTED',
};

export type ReviewComment = {
    path: string;
    line: number;
    side: 'LEFT' | 'RIGHT';
    body: string;
};

export type ReviewDocument = {
    event: ReviewEvent;
    body: string;
    comments: ReviewComment[];
};

export type PublishReviewPort = {
    primaryRoot: () => string;
    currentHead: (number: number) => string;
    readReviewJson: (path: string) => unknown;
    postReview: (input: {
        number: number;
        commitId: string;
        event: ReviewEvent;
        body: string;
        comments: ReviewComment[];
    }) => { id: number; login: string };
    log: (message: string) => void;
};

export function parsePublishReviewArgs(args: string[]): { number?: number; help: boolean } {
    if (args[0] === '--help') {
        if (args.length !== 1) {
            fail('--help takes no other arguments');
        }
        return { help: true };
    }
    const value = Number(args[0]);
    if (!Number.isSafeInteger(value) || value <= 0 || args.length !== 1) {
        fail('usage: pnpm review:publish <pr-number>');
    }
    return { number: value, help: false };
}

export function parseReviewDocument(value: unknown): ReviewDocument {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        fail('review.json must be an object');
    }
    const record = value as Record<string, unknown>;
    if (record.event !== 'APPROVE' && record.event !== 'REQUEST_CHANGES') {
        fail('review.json event must be APPROVE or REQUEST_CHANGES');
    }
    const comments = parseComments(record.comments);
    const body = typeof record.body === 'string' ? record.body : '';
    if (record.event === 'REQUEST_CHANGES') {
        if (comments.length === 0) {
            fail('REQUEST_CHANGES requires comments');
        }
        if (body.trim() === '') {
            fail('REQUEST_CHANGES requires a top-level body');
        }
    }
    return { event: record.event, body, comments };
}

export function publishReview(number: number, port: PublishReviewPort): number {
    const headSha = port.currentHead(number);
    const bundle = reviewBundlePath(port.primaryRoot(), number, headSha);
    let parsed: unknown;
    try {
        parsed = port.readReviewJson(join(bundle, 'review.json'));
    } catch {
        fail(`missing review.json at ${join(bundle, 'review.json')}`);
    }
    const document = parseReviewDocument(parsed);
    const current = port.currentHead(number);
    if (current !== headSha) {
        fail('pull-request head moved; refusing to post a stale review');
    }
    const posted = port.postReview({
        number,
        commitId: headSha,
        event: document.event,
        body: document.body,
        comments: document.comments,
    });
    if (posted.login !== REVIEWER_BOT_LOGIN) {
        fail(`review was posted as ${posted.login}, not ${REVIEWER_BOT_LOGIN}`);
    }
    port.log(String(posted.id));
    return posted.id;
}

export function shellPort(
    session: GhSession,
    cwd: string = process.cwd(),
    capture: typeof spawnCapture = spawnCapture
): PublishReviewPort {
    const primaryRoot = resolvePrimaryRoot(
        (command, args, directory) => capture(command, args, { cwd: directory }),
        cwd
    );
    const gh = (args: string[], input?: string) => capture('gh', args, { cwd: primaryRoot, env: session.env, input });
    return {
        primaryRoot: () => primaryRoot,
        currentHead: (number) =>
            capture(
                'gh',
                [
                    'pr',
                    'view',
                    String(number),
                    '--repo',
                    REQUIRED_REPOSITORY,
                    '--json',
                    'headRefOid',
                    '--jq',
                    '.headRefOid',
                ],
                { cwd: primaryRoot, env: session.env }
            ),
        readReviewJson: (path) => JSON.parse(readFileSync(path, 'utf8')) as unknown,
        postReview: ({ number, commitId, event, body, comments }) => {
            const response = parseJson<{ id: number; state?: string; user?: { login?: string } }>(
                gh(
                    ['api', '--method', 'POST', `repos/${REQUIRED_REPOSITORY}/pulls/${number}/reviews`, '--input', '-'],
                    JSON.stringify({
                        commit_id: commitId,
                        event,
                        body,
                        comments: comments.map((comment) => ({
                            path: comment.path,
                            line: comment.line,
                            side: comment.side,
                            body: comment.body,
                        })),
                    })
                ),
                'create review'
            );
            if (!Number.isSafeInteger(response.id) || response.id <= 0) {
                fail('create review returned an unreadable id');
            }
            const expectedState = EXPECTED_REVIEW_STATE[event];
            if (response.state !== expectedState) {
                fail(
                    `review ${response.id} requested ${event} but GitHub recorded ${response.state ?? 'no state'}; refusing to report success`
                );
            }
            return { id: response.id, login: response.user?.login ?? '' };
        },
        log: (message) => {
            console.log(message);
        },
    };
}

function parseComments(value: unknown): ReviewComment[] {
    if (value === undefined) {
        return [];
    }
    if (!Array.isArray(value)) {
        fail('review.json comments must be an array');
    }
    return value.map((entry, index) => {
        if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
            fail(`review.json comments[${index}] must be an object`);
        }
        const record = entry as Record<string, unknown>;
        const path = record.path;
        const line = record.line;
        const side = record.side;
        const body = record.body;
        if (typeof path !== 'string' || path === '') {
            fail(`review.json comments[${index}] path is invalid`);
        }
        if (typeof line !== 'number' || !Number.isSafeInteger(line) || line <= 0) {
            fail(`review.json comments[${index}] line is invalid`);
        }
        if (side !== 'LEFT' && side !== 'RIGHT') {
            fail(`review.json comments[${index}] side must be LEFT or RIGHT`);
        }
        if (typeof body !== 'string') {
            fail(`review.json comments[${index}] body is invalid`);
        }
        assertReviewCommentBody(body);
        return { path, line, side, body };
    });
}

async function main(): Promise<number> {
    const parsed = parsePublishReviewArgs(process.argv.slice(2));
    if (parsed.help) {
        console.log('Usage: pnpm review:publish <pr-number>');
        return 0;
    }
    if (parsed.number === undefined) {
        fail('usage: pnpm review:publish <pr-number>');
    }
    const executingFile = fileURLToPath(import.meta.url);
    const cwd = process.cwd();
    assertTrustedExecutingBlob(
        'scripts/publishReview.ts',
        executingFile,
        originMainBlob('scripts/publishReview.ts', cwd)
    );
    const primaryRoot = resolvePrimaryRoot();
    const auth = await authenticateRole({ primaryRoot, role: 'reviewer' });
    try {
        if (auth.minted.login !== REVIEWER_BOT_LOGIN) {
            fail(`minted login ${auth.minted.login} is not ${REVIEWER_BOT_LOGIN}`);
        }
        const repository = spawnCapture('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], {
            env: auth.session.env,
            cwd: primaryRoot,
        });
        assertRequiredRepository(repository);
        publishReview(parsed.number, shellPort(auth.session));
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
