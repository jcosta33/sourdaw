import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REVIEWER_BOT_NODE_ID, SHADOW_REVIEWER_MINT_PERMISSIONS, type GitHubJsonClient } from '../githubAppIdentity.ts';
import {
    SHADOW_STATUS_CONTEXT,
    SHADOW_STATUS_FORMAT,
    SHADOW_STATUS_USAGE,
    authenticateShadowReviewer,
    buildReviewShadowStatus,
    coordinateReviewShadowStatus,
    emitReviewShadowStatus,
    parseReviewShadowStatusArgs,
    postCommitStatus,
    readPullRequestHead,
    readReviewerReviews,
    readRulesetRequiredContexts,
    renderShadowStatusDescription,
    reviewerReviewsQuery,
    runReviewShadowStatusCli,
    selectReviewOnHead,
    shadowStatusState,
    shortHead,
    type ReviewerReview,
    type ReviewShadowStatusCoordinatorDependencies,
    type ReviewShadowStatusPayload,
    type ReviewShadowStatusPort,
} from '../reviewShadowStatus.ts';

const PR = 3_002;
const HEAD = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0';
const MOVED_HEAD = '0f1e2d3c4b5a69788796a5b4c3d2e1f001234567';
const REVIEW_ID = 5_257_275_331;

/** The exact six-field fact and the exact bytes a commit status carries for it. */
function goldenPayload(): ReviewShadowStatusPayload {
    return {
        format: SHADOW_STATUS_FORMAT,
        pr: PR,
        headSha: HEAD,
        reviewId: REVIEW_ID,
        reviewHeadSha: HEAD,
        verdict: 'approved',
    };
}

const GOLDEN_DESCRIPTION = 'review-shadow-v1 a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0 5257275331 approved';

/** The reviewer App's approval on exactly HEAD, as the live review connection reports it. */
function reviewOnHead(overrides: Partial<ReviewerReview> = {}): ReviewerReview {
    return { id: REVIEW_ID, commit: HEAD, verdict: 'approved', ...overrides };
}

type PostedStatus = { head: string; description: string; state: string };

function fakePort(input: { head?: string; reviews?: ReviewerReview[]; shadowContextRequired?: boolean } = {}): {
    port: ReviewShadowStatusPort;
    calls: string[];
    logs: string[];
    posted: PostedStatus[];
} {
    const calls: string[] = [];
    const logs: string[] = [];
    const posted: PostedStatus[] = [];
    const port: ReviewShadowStatusPort = {
        pullRequestHead: (pr) => {
            calls.push(`head:${String(pr)}`);
            return input.head ?? HEAD;
        },
        reviewerReviews: (pr) => {
            calls.push(`reviews:${String(pr)}`);
            return input.reviews ?? [reviewOnHead()];
        },
        shadowContextRequired: () => {
            calls.push('ruleset');
            return input.shadowContextRequired ?? false;
        },
        postShadowStatus: (head, description, state) => {
            calls.push(`post:${head}`);
            posted.push({ head, description, state });
        },
        log: (message) => {
            logs.push(message);
        },
    };
    return { port, calls, logs, posted };
}

describe('reviewShadowStatus bytes', () => {
    it('should pin the format, context and usage strings', () => {
        expect(SHADOW_STATUS_FORMAT).toBe('review-shadow-v1');
        expect(SHADOW_STATUS_CONTEXT).toBe('sourdaw/reviewer-shadow');
        expect(SHADOW_STATUS_USAGE).toBe('usage: pnpm review:shadow-status <pr-number> --head <full-sha>');
    });

    it('should build the golden payload from the exact six fields', () => {
        expect(buildReviewShadowStatus(goldenPayload())).toEqual(goldenPayload());
    });

    it('should render the golden description as one line', () => {
        expect(renderShadowStatusDescription(goldenPayload())).toBe(GOLDEN_DESCRIPTION);
        expect(GOLDEN_DESCRIPTION).not.toMatch(/[\r\n\u2028\u2029]/u);
    });

    it('should derive the commit-status state from the verdict', () => {
        expect(shadowStatusState('approved')).toBe('success');
        expect(shadowStatusState('changes-requested')).toBe('failure');
    });

    it('should name a receipt by the seven-character short head', () => {
        expect(shortHead(HEAD)).toBe('a1b2c3d');
    });
});

describe('buildReviewShadowStatus refusals', () => {
    const FORBIDDEN_FIELDS: ReadonlyArray<readonly [string, unknown]> = [
        ['title', 'feat(review): a title'],
        ['body', 'A body.'],
        ['issue', PR],
        ['milestone', 'v1.0.0'],
        ['mergeAuthority', true],
    ];

    it.each(FORBIDDEN_FIELDS)('should refuse the forbidden %s field by name', (key, value) => {
        expect(() => buildReviewShadowStatus({ ...goldenPayload(), [key]: value })).toThrow(
            `review shadow status refuses forbidden key ${key}`
        );
    });

    it('should refuse a named forbidden field and an unknown field alike', () => {
        expect(() => buildReviewShadowStatus({ ...goldenPayload(), author: 'jcosta33' })).toThrow(
            'review shadow status refuses forbidden key author'
        );
        expect(() => buildReviewShadowStatus({ ...goldenPayload(), label: 'enhancement' })).toThrow(
            'review shadow status refuses forbidden key label'
        );
        expect(() => buildReviewShadowStatus({ ...goldenPayload(), labels: ['enhancement'] })).toThrow(
            'review shadow status refuses unknown key labels'
        );
    });

    it('should refuse input that is not a plain object', () => {
        for (const input of [undefined, null, 'status', 42, [], [goldenPayload()]]) {
            expect(() => buildReviewShadowStatus(input), JSON.stringify(input) ?? 'undefined').toThrow(
                'review shadow status input must be a JSON object'
            );
        }
    });

    it('should refuse a missing field', () => {
        const { verdict: _verdict, ...withoutVerdict } = goldenPayload();
        expect(() => buildReviewShadowStatus(withoutVerdict)).toThrow(
            'review shadow status is missing required key verdict'
        );
    });

    it('should refuse a non-positive-integer pr or reviewId', () => {
        for (const pr of [0, -1, 1.5, '3002', null, Number.MAX_SAFE_INTEGER + 1]) {
            expect(() => buildReviewShadowStatus({ ...goldenPayload(), pr }), `pr ${String(pr)}`).toThrow(
                'review shadow status pr must be a positive safe integer'
            );
        }
        for (const reviewId of [0, -7, 2.5, String(REVIEW_ID), null]) {
            expect(
                () => buildReviewShadowStatus({ ...goldenPayload(), reviewId }),
                `reviewId ${String(reviewId)}`
            ).toThrow('review shadow status reviewId must be a positive safe integer');
        }
    });

    it('should refuse a head that is not 40 lowercase hex characters', () => {
        for (const headSha of [HEAD.toUpperCase(), HEAD.slice(0, 39), HEAD.slice(0, 7), `${HEAD}0`, '', null]) {
            expect(
                () => buildReviewShadowStatus({ ...goldenPayload(), headSha, reviewHeadSha: headSha }),
                `head ${String(headSha)}`
            ).toThrow('review shadow status headSha must be 40 lowercase hex characters');
        }
    });

    it('should refuse a verdict outside the union', () => {
        for (const verdict of ['APPROVED', 'approved ', 'commented', '', null]) {
            expect(
                () => buildReviewShadowStatus({ ...goldenPayload(), verdict }),
                `verdict ${String(verdict)}`
            ).toThrow('review shadow status verdict must be approved or changes-requested');
        }
    });

    it('should refuse an approval whose review names another commit', () => {
        expect(() => buildReviewShadowStatus({ ...goldenPayload(), reviewHeadSha: MOVED_HEAD })).toThrow(
            `review shadow status refuses reviewHeadSha ${MOVED_HEAD}: the review binds head ${HEAD}, not this one`
        );
    });
});

describe('renderShadowStatusDescription bounds', () => {
    /**
     * Two bounds, both stating the same invariant. A 133-character head composes a line past the
     * ceiling, where the renderer must refuse every character rather than return a prefix — a
     * truncating renderer would fail the equality below. The golden line sits far inside the ceiling,
     * because a real payload carries a 40-hex head and a safe-integer review id.
     */
    it('should refuse rather than truncate when the line exceeds 140 characters', () => {
        const headSha = 'a'.repeat(133);
        const payload = { ...goldenPayload(), headSha };
        const line = `${SHADOW_STATUS_FORMAT} ${headSha} ${String(REVIEW_ID)} approved`;
        expect(line.length).toBeGreaterThan(140);
        expect(() => renderShadowStatusDescription(payload)).toThrow(
            `review shadow status description is ${String(line.length)} characters; maximum is 140`
        );
        expect(line.slice(0, 140)).not.toBe(line);
    });

    it('should render the whole golden line, well inside the ceiling and free of any line break', () => {
        const line = renderShadowStatusDescription(goldenPayload());
        expect(line).toBe(GOLDEN_DESCRIPTION);
        expect(line).toBe(`${SHADOW_STATUS_FORMAT} ${HEAD} ${String(REVIEW_ID)} approved`);
        expect(line.length).toBe(77);
        expect(line.length).toBeLessThan(140);
        expect(line).not.toMatch(/[\r\n\u2028\u2029]/u);
    });

    it('should refuse a payload whose fields carry a line break', () => {
        expect(() => renderShadowStatusDescription({ ...goldenPayload(), headSha: `${HEAD}\n${HEAD}` })).toThrow(
            'review shadow status description must be one line'
        );
    });
});

describe('selectReviewOnHead', () => {
    it('should take the newest reviewer review on the exactly requested head', () => {
        const reviews = [
            reviewOnHead({ id: 1, commit: MOVED_HEAD }),
            reviewOnHead({ id: 2 }),
            reviewOnHead({ id: 3, commit: MOVED_HEAD }),
        ];
        expect(selectReviewOnHead(reviews, HEAD)?.id).toBe(2);
    });

    it('should select nothing when the reviewer only reviewed another commit', () => {
        expect(selectReviewOnHead([reviewOnHead({ commit: MOVED_HEAD })], HEAD)).toBeUndefined();
    });
});

describe('emitReviewShadowStatus', () => {
    it('should post exactly one commit status with the golden description, context and state', () => {
        const { port, calls, logs, posted } = fakePort();
        const receipt = `review-shadow-status:${String(PR)}:a1b2c3d:${String(REVIEW_ID)}:approved`;
        expect(emitReviewShadowStatus(PR, HEAD, port)).toBe(receipt);
        expect(posted).toEqual([{ head: HEAD, description: GOLDEN_DESCRIPTION, state: 'success' }]);
        expect(GOLDEN_DESCRIPTION).toBe(`${SHADOW_STATUS_FORMAT} ${HEAD} ${String(REVIEW_ID)} approved`);
        expect(calls).toEqual([`head:${String(PR)}`, 'ruleset', `reviews:${String(PR)}`, `post:${HEAD}`]);
        expect(logs).toEqual([receipt]);
    });

    it('should derive a failure state from a changes-requested verdict', () => {
        const { port, posted } = fakePort({ reviews: [reviewOnHead({ verdict: 'changes-requested' })] });
        expect(emitReviewShadowStatus(PR, HEAD, port)).toBe(
            `review-shadow-status:${String(PR)}:a1b2c3d:${String(REVIEW_ID)}:changes-requested`
        );
        expect(posted).toEqual([
            {
                head: HEAD,
                description: `${SHADOW_STATUS_FORMAT} ${HEAD} ${String(REVIEW_ID)} changes-requested`,
                state: 'failure',
            },
        ]);
    });

    it('should refuse a moved head before reading reviews or posting anything', () => {
        const { port, calls, posted } = fakePort({ head: MOVED_HEAD });
        expect(() => emitReviewShadowStatus(PR, HEAD, port)).toThrow(`head moved: ${MOVED_HEAD} is not ${HEAD}`);
        expect(calls).toEqual([`head:${String(PR)}`]);
        expect(posted).toEqual([]);
    });

    it('should refuse a required shadow context before posting anything', () => {
        const { port, calls, posted } = fakePort({ shadowContextRequired: true });
        expect(() => emitReviewShadowStatus(PR, HEAD, port)).toThrow(
            `refusing to post shadow status ${SHADOW_STATUS_CONTEXT}: the live main ruleset requires that context`
        );
        expect(calls).toEqual([`head:${String(PR)}`, 'ruleset']);
        expect(posted).toEqual([]);
    });

    it('should refuse when the reviewer App has no review on that exact head', () => {
        const { port, calls, posted } = fakePort({ reviews: [reviewOnHead({ commit: MOVED_HEAD })] });
        expect(() => emitReviewShadowStatus(PR, HEAD, port)).toThrow(
            `refusing to post shadow status: the reviewer App has no review on head ${HEAD}`
        );
        expect(calls).toEqual([`head:${String(PR)}`, 'ruleset', `reviews:${String(PR)}`]);
        expect(posted).toEqual([]);
    });
});

describe('parseReviewShadowStatusArgs', () => {
    it('should read the pull request and the full head', () => {
        expect(parseReviewShadowStatusArgs([String(PR), '--head', HEAD])).toEqual({
            number: PR,
            head: HEAD,
            help: false,
        });
    });

    it('should refuse a missing or unknown head flag', () => {
        expect(() => parseReviewShadowStatusArgs([String(PR)])).toThrow(SHADOW_STATUS_USAGE);
        expect(() => parseReviewShadowStatusArgs([String(PR), HEAD])).toThrow(SHADOW_STATUS_USAGE);
        expect(() => parseReviewShadowStatusArgs([String(PR), '--heads', HEAD])).toThrow(SHADOW_STATUS_USAGE);
    });

    it('should refuse an abbreviated or uppercase head', () => {
        expect(() => parseReviewShadowStatusArgs([String(PR), '--head', HEAD.slice(0, 7)])).toThrow(
            SHADOW_STATUS_USAGE
        );
        expect(() => parseReviewShadowStatusArgs([String(PR), '--head', HEAD.toUpperCase()])).toThrow(
            SHADOW_STATUS_USAGE
        );
    });

    it('should refuse a non-numeric pull request', () => {
        for (const number of ['abc', '0', '-3', '3.5', '']) {
            expect(() => parseReviewShadowStatusArgs([number, '--head', HEAD]), number).toThrow(SHADOW_STATUS_USAGE);
        }
    });

    it('should accept --help alone and refuse it beside other arguments', () => {
        expect(parseReviewShadowStatusArgs(['--help'])).toEqual({ help: true });
        expect(() => parseReviewShadowStatusArgs(['--help', String(PR)])).toThrow('--help takes no other arguments');
    });
});

describe('readReviewerReviews', () => {
    function reviewNode(overrides: Record<string, unknown> = {}) {
        return {
            id: 'PRR_kwDORobapc8AAAABOVunww',
            fullDatabaseId: String(REVIEW_ID),
            state: 'APPROVED',
            commit: { oid: HEAD },
            author: { __typename: 'Bot', login: 'tmckenna1611', id: REVIEWER_BOT_NODE_ID },
            ...overrides,
        };
    }

    function page(nodes: unknown[], pageInfo: Record<string, unknown>) {
        return { data: { repository: { pullRequest: { reviews: { nodes, pageInfo } } } } };
    }

    function recordingGh(respond: (call: { fields: Record<string, string>; args: string[] }) => unknown) {
        const calls: { fields: Record<string, string>; args: string[] }[] = [];
        const gh = (args: string[]) => {
            const fields: Record<string, string> = {};
            for (let index = 0; index < args.length - 1; index += 1) {
                const [key, ...rest] = (args[index + 1] ?? '').split('=');
                fields[key ?? ''] = rest.join('=');
            }
            calls.push({ fields, args });
            return JSON.stringify(respond({ fields, args }));
        };
        return { gh, calls };
    }

    it('should send the numeric pull request variable through the typed flag', () => {
        const { gh, calls } = recordingGh(() => page([], { hasPreviousPage: false, startCursor: null }));
        readReviewerReviews(PR, gh, ['-f', 'owner=jcosta33', '-f', 'name=sourdaw']);
        expect(calls[0]?.args).toEqual([
            'api',
            'graphql',
            '-f',
            `query=${reviewerReviewsQuery()}`,
            '-f',
            'owner=jcosta33',
            '-f',
            'name=sourdaw',
            '-F',
            `number=${String(PR)}`,
        ]);
    });

    it('should read only the reviewer App reviews that carry a verdict', () => {
        const { gh } = recordingGh(() =>
            page(
                [
                    reviewNode(),
                    reviewNode({
                        id: 'PRR_human',
                        fullDatabaseId: '12',
                        author: { __typename: 'User', login: 'jcosta33' },
                    }),
                    reviewNode({ id: 'PRR_comment', fullDatabaseId: '13', state: 'COMMENTED' }),
                    reviewNode({
                        id: 'PRR_author',
                        fullDatabaseId: '14',
                        author: { __typename: 'Bot', login: 'hplovecraft208', id: 'BOT_kgDOEv71mA' },
                    }),
                    reviewNode({ fullDatabaseId: '15', state: 'CHANGES_REQUESTED', commit: { oid: MOVED_HEAD } }),
                ],
                { hasPreviousPage: false, startCursor: null }
            )
        );
        expect(readReviewerReviews(PR, gh, [])).toEqual([
            { id: REVIEW_ID, commit: HEAD, verdict: 'approved' },
            { id: 15, commit: MOVED_HEAD, verdict: 'changes-requested' },
        ]);
    });

    it('should walk older pages and return the reviews oldest-first', () => {
        const { gh, calls } = recordingGh((call) => {
            if (call.fields.before === undefined) {
                return page([reviewNode({ fullDatabaseId: '20' })], {
                    hasPreviousPage: true,
                    startCursor: 'CURSOR',
                });
            }
            return page([reviewNode({ fullDatabaseId: '10' })], { hasPreviousPage: false, startCursor: null });
        });
        expect(readReviewerReviews(PR, gh, []).map((review) => review.id)).toEqual([10, 20]);
        expect(calls.map((call) => call.fields.before)).toEqual([undefined, 'CURSOR']);
    });

    it('should refuse a repeated cursor, an unreadable page and an unreadable review', () => {
        const { gh: repeated } = recordingGh(() => page([], { hasPreviousPage: true, startCursor: 'CURSOR' }));
        expect(() => readReviewerReviews(PR, repeated, [])).toThrow(
            `PR #${String(PR)} reviews returned invalid review pagination`
        );

        const { gh: unreadablePage } = recordingGh(() => page([], {}));
        expect(() => readReviewerReviews(PR, unreadablePage, [])).toThrow(
            `PR #${String(PR)} reviews returned an unreadable review page`
        );

        const { gh: unreadableReview } = recordingGh(() => page([42], { hasPreviousPage: false, startCursor: null }));
        expect(() => readReviewerReviews(PR, unreadableReview, [])).toThrow(
            `PR #${String(PR)} reviews is not a readable pull request review`
        );
    });

    it('should refuse a reviewer review whose numeric id is missing', () => {
        const { gh } = recordingGh(() =>
            page([reviewNode({ fullDatabaseId: null })], { hasPreviousPage: false, startCursor: null })
        );
        expect(() => readReviewerReviews(PR, gh, [])).toThrow('must carry a numeric fullDatabaseId');
    });

    it('should refuse a reviewer review that names no 40-hex commit', () => {
        const { gh } = recordingGh(() =>
            page([reviewNode({ commit: null })], { hasPreviousPage: false, startCursor: null })
        );
        expect(() => readReviewerReviews(PR, gh, [])).toThrow('must name the 40-hex commit it reviewed');
    });
});

describe('readPullRequestHead', () => {
    function headGh(value: unknown) {
        return (args: string[]) => {
            expect(args[0]).toBe('api');
            return JSON.stringify({ data: { repository: { pullRequest: { headRefOid: value } } } });
        };
    }

    it('should read the live head and refuse one that is not 40-hex', () => {
        expect(readPullRequestHead(PR, headGh(HEAD), [])).toBe(HEAD);
        expect(() => readPullRequestHead(PR, headGh('nope'), [])).toThrow(
            `PR #${String(PR)} head is not a readable pull request head`
        );
        expect(() => readPullRequestHead(PR, headGh(null), [])).toThrow(
            `PR #${String(PR)} head is not a readable pull request head`
        );
    });
});

describe('readRulesetRequiredContexts', () => {
    const REPOSITORY = 'jcosta33/sourdaw';

    function rulesGh(rules: unknown) {
        return (args: string[]) => {
            expect(args).toEqual(['api', `repos/${REPOSITORY}/rules/branches/main`]);
            return JSON.stringify(rules);
        };
    }

    it('should read the union of every required status check context', () => {
        expect(
            readRulesetRequiredContexts(
                REPOSITORY,
                rulesGh([
                    { type: 'deletion' },
                    { type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'Gate' }] } },
                    {
                        type: 'required_status_checks',
                        parameters: {
                            required_status_checks: [{ context: 'Gate' }, { context: SHADOW_STATUS_CONTEXT }],
                        },
                    },
                ])
            )
        ).toEqual(['Gate', SHADOW_STATUS_CONTEXT]);
    });

    it('should refuse a malformed ruleset read rather than read it as empty', () => {
        expect(() => readRulesetRequiredContexts(REPOSITORY, rulesGh([{ type: 'deletion' }]))).toThrow(
            `branch ruleset for ${REPOSITORY} carries no required_status_checks rule with a parameters array`
        );
        expect(() =>
            readRulesetRequiredContexts(REPOSITORY, rulesGh([{ type: 'required_status_checks', parameters: {} }]))
        ).toThrow('carries a required_status_checks rule with no parameters array');
        expect(() => readRulesetRequiredContexts(REPOSITORY, rulesGh({}))).toThrow(
            `branch ruleset for ${REPOSITORY} is not a readable rule list`
        );
    });
});

describe('postCommitStatus', () => {
    it('should post the context, description and state and check the receipt', () => {
        const calls: string[][] = [];
        const gh = (args: string[]) => {
            calls.push(args);
            return JSON.stringify({
                context: SHADOW_STATUS_CONTEXT,
                description: GOLDEN_DESCRIPTION,
                state: 'success',
                sha: HEAD,
            });
        };
        postCommitStatus(HEAD, GOLDEN_DESCRIPTION, 'success', 'jcosta33/sourdaw', gh);
        expect(calls).toHaveLength(1);
        expect(calls[0]?.slice(0, 4)).toEqual(['api', `repos/jcosta33/sourdaw/statuses/${HEAD}`, '--method', 'POST']);
        expect(calls[0]).toContain(`context=${SHADOW_STATUS_CONTEXT}`);
        expect(calls[0]).toContain(`description=${GOLDEN_DESCRIPTION}`);
        expect(calls[0]).toContain('state=success');
    });

    it('should refuse a receipt that does not record what was requested', () => {
        const gh = () =>
            JSON.stringify({ context: SHADOW_STATUS_CONTEXT, description: 'other', state: 'success', sha: HEAD });
        expect(() => postCommitStatus(HEAD, GOLDEN_DESCRIPTION, 'success', 'jcosta33/sourdaw', gh)).toThrow(
            `commit status for ${HEAD} was not recorded as requested`
        );
    });
});

describe('authenticateShadowReviewer', () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2_048 });
    const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();

    function credentialFiles() {
        const directory = mkdtempSync(join(tmpdir(), 'sourdaw-shadow-status-'));
        const keyPath = join(directory, 'reviewer-private-key');
        writeFileSync(keyPath, pem, 'utf8');
        const text = [
            'SOURDAW_GITHUB_APP_ID=4650634',
            'SOURDAW_GITHUB_APP_INSTALLATION_ID=99',
            `SOURDAW_GITHUB_APP_PRIVATE_KEY_FILE=${keyPath}`,
            '',
        ].join('\n');
        return { directory, keyPath, credentialText: text };
    }

    function mintClient() {
        const requests: { url: string; body?: string }[] = [];
        const request: GitHubJsonClient = async (url, init) => {
            requests.push({ url, body: init.body });
            if (url.endsWith('/access_tokens')) {
                return {
                    status: 201,
                    body: {
                        token: 'ghs_shadow',
                        permissions: { contents: 'read', pull_requests: 'write', statuses: 'write' },
                    },
                };
            }
            if (url.endsWith('/app')) {
                return { status: 200, body: { slug: 'tmckenna1611' } };
            }
            return { status: 200, body: { node_id: REVIEWER_BOT_NODE_ID, login: 'tmckenna1611[bot]', type: 'Bot' } };
        };
        return { requests, request };
    }

    it('should pin the dedicated mint set that carries statuses write', () => {
        expect(SHADOW_REVIEWER_MINT_PERMISSIONS).toEqual({
            contents: 'read',
            pull_requests: 'write',
            statuses: 'write',
        });
    });

    it('should request only that set through the reviewer credentials', async () => {
        const { directory, keyPath, credentialText } = credentialFiles();
        const { requests, request } = mintClient();
        const reads: string[] = [];
        try {
            const auth = await authenticateShadowReviewer(
                '/repo',
                (path) => {
                    reads.push(path);
                    return path === keyPath ? pem : credentialText;
                },
                request,
                {}
            );
            try {
                expect(JSON.parse(requests[0]?.body ?? '{}')).toEqual({
                    permissions: SHADOW_REVIEWER_MINT_PERMISSIONS,
                });
                expect(reads.some((path) => path.endsWith('.env.sourdaw-reviewer'))).toBe(true);
                expect(reads.some((path) => path.endsWith('.env.sourdaw-author'))).toBe(false);
                expect(auth.minted.actorNodeId).toBe(REVIEWER_BOT_NODE_ID);
            } finally {
                auth.session.dispose();
            }
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    });
});

describe('coordinateReviewShadowStatus', () => {
    function coordinator(emit: (number: number, head: string) => string) {
        const sessions: { disposed: boolean }[] = [];
        const dependencies: ReviewShadowStatusCoordinatorDependencies = {
            primaryRoot: () => '/repo',
            authenticateReviewer: async () => {
                const state = { disposed: false };
                sessions.push(state);
                return {
                    minted: { actorNodeId: REVIEWER_BOT_NODE_ID },
                    session: {
                        configDir: '/tmp/sourdaw-shadow',
                        env: {},
                        dispose: () => {
                            state.disposed = true;
                        },
                    },
                };
            },
            repositoryName: () => 'jcosta33/sourdaw',
            port: () => fakePort().port,
            emit: (number, head) => emit(number, head),
        };
        return { dependencies, sessions };
    }

    it('should authenticate the reviewer App, assert the repository and return the receipt', async () => {
        const { dependencies, sessions } = coordinator(() => 'review-shadow-status:receipt');
        await expect(coordinateReviewShadowStatus(PR, HEAD, dependencies)).resolves.toBe(
            'review-shadow-status:receipt'
        );
        expect(sessions.map((session) => session.disposed)).toEqual([true]);
    });

    it('should refuse a foreign repository before emitting anything', async () => {
        const emitted: string[] = [];
        const { dependencies, sessions } = coordinator((number, head) => {
            emitted.push(`${String(number)}:${head}`);
            return 'unreachable';
        });
        const foreign: ReviewShadowStatusCoordinatorDependencies = {
            ...dependencies,
            repositoryName: () => 'someone/else',
        };
        await expect(coordinateReviewShadowStatus(PR, HEAD, foreign)).rejects.toThrow(
            'refusing to operate on someone/else; expected jcosta33/sourdaw'
        );
        expect(emitted).toEqual([]);
        expect(sessions.map((session) => session.disposed)).toEqual([true]);
    });
});

describe('runReviewShadowStatusCli', () => {
    it('should print the usage for --help and refuse a malformed invocation', async () => {
        await expect(runReviewShadowStatusCli(['--help'])).resolves.toBe(0);
        await expect(runReviewShadowStatusCli([String(PR)])).rejects.toThrow(SHADOW_STATUS_USAGE);
    });

    it('should emit through the coordinator for a well-formed invocation', async () => {
        const emitted: string[] = [];
        const dependencies: ReviewShadowStatusCoordinatorDependencies = {
            primaryRoot: () => '/repo',
            authenticateReviewer: async () => ({
                minted: { actorNodeId: REVIEWER_BOT_NODE_ID },
                session: { configDir: '/tmp/sourdaw-shadow', env: {}, dispose: () => undefined },
            }),
            repositoryName: () => 'jcosta33/sourdaw',
            port: () => fakePort().port,
            emit: (number, head) => {
                emitted.push(`${String(number)}:${head}`);
                return 'receipt';
            },
        };
        await expect(runReviewShadowStatusCli([String(PR), '--head', HEAD], dependencies)).resolves.toBe(0);
        expect(emitted).toEqual([`${String(PR)}:${HEAD}`]);
    });
});
