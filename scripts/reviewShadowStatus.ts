#!/usr/bin/env node
/**
 * The reviewer's commit-only shadow status for one pull-request head (#3002).
 *
 * A shadow review states one fact about one commit: this reviewer App reviewed this exact head and
 * reached this verdict. The status payload therefore admits the six fields that fact needs and
 * refuses anything else by name — a title, body, issue, author, label, milestone or merge-authority
 * claim is a different fact, and an approval whose review names another commit is not a fact about
 * this head at all. The rendered description is one short line rather than a truncation, because a
 * truncated status still reads as a complete claim.
 *
 * The status is deliberately a shadow: it is refused before any write while the live `main` ruleset
 * requires a context of this name, so this command can never become the required check. It posts as
 * the reviewer App, and its own dedicated mint asks for `statuses: write`, which posting a commit
 * status needs and which no other reviewer command may be broadened to carry.
 */

import {
    REVIEWER_BOT_NODE_ID,
    SHADOW_REVIEWER_MINT_PERMISSIONS,
    assertRequiredRepository,
    authenticateRole,
    isReviewerBotNodeId,
    parseGraphqlResponse,
    resolvePrimaryRoot,
    spawnCapture,
    type FileReader,
    type GhSession,
    type GitHubJsonClient,
} from './githubAppIdentity.ts';
import { fail } from './prContract.ts';

export const SHADOW_STATUS_FORMAT = 'review-shadow-v1';
export const SHADOW_STATUS_CONTEXT = 'sourdaw/reviewer-shadow';

export const SHADOW_STATUS_USAGE = 'usage: pnpm review:shadow-status <pr-number> --head <full-sha>';

export type ShadowStatusVerdict = 'approved' | 'changes-requested';

/** The commit-status state GitHub renders for a verdict; `failure` is the state a rejected commit carries. */
export type ShadowStatusState = 'success' | 'failure';

/**
 * Everything this status states: the format, the pull request, the exact head, the reviewer App's
 * review, the commit that review names, and its verdict. No other field is part of the fact.
 */
export type ReviewShadowStatusPayload = {
    format: 'review-shadow-v1';
    pr: number;
    headSha: string;
    reviewId: number;
    reviewHeadSha: string;
    verdict: ShadowStatusVerdict;
};

/** The reviewer App's own review, as the port reads it from the pull request's review connection. */
export type ReviewerReview = { id: number; commit: string; verdict: ShadowStatusVerdict };

export type ReviewShadowStatusPort = {
    /** The live head of the pull request, read fresh; the caller compares it before any write. */
    pullRequestHead(pr: number): string;
    /** Every readable reviewer-App review on the pull request; a caller filters by `commit`. */
    reviewerReviews(pr: number): ReviewerReview[];
    /** Whether the live `main` ruleset requires a status context named `SHADOW_STATUS_CONTEXT`. */
    shadowContextRequired(): boolean;
    postShadowStatus(head: string, description: string, state: ShadowStatusState): void;
    log(message: string): void;
};

export type ReviewShadowStatusCoordinatorDependencies = {
    primaryRoot: () => string;
    authenticateReviewer: (primaryRoot: string) => Promise<ReviewShadowStatusAuthentication>;
    repositoryName: (session: GhSession, primaryRoot: string) => string;
    port: (session: GhSession, primaryRoot: string) => ReviewShadowStatusPort;
    emit: (number: number, head: string, port: ReviewShadowStatusPort) => string;
};

export type ReviewShadowStatusAuthentication = {
    minted: { actorNodeId: string };
    session: GhSession;
};

export type ReviewShadowStatusArgs = { number?: number; head?: string; help: boolean };

/**
 * The exact fields the payload carries, and the claim-bearing fields named individually so a refusal
 * names the key a caller actually sent. Keeping the allowlist exact is what keeps a forbidden claim
 * out by construction rather than by filtering one out later.
 */
const STATUS_KEYS: ReadonlySet<string> = new Set(['format', 'pr', 'headSha', 'reviewId', 'reviewHeadSha', 'verdict']);

const FORBIDDEN_KEYS: ReadonlySet<string> = new Set([
    'title',
    'body',
    'issue',
    'author',
    'label',
    'milestone',
    'mergeAuthority',
]);

const HEAD_SHA_PATTERN = /^[0-9a-f]{40}$/;
const FORTY_HEX_PATTERN = /^[0-9a-f]{40}$/;
const DECIMAL_PATTERN = /^[1-9][0-9]*$/;

/** A rendered status description is one commit-status line, which GitHub bounds at 140 characters. */
const MAX_DESCRIPTION_LENGTH = 140;

/** A single line cannot carry a line break, and the non-ASCII separators break one just as `\n` does. */
const LINE_BREAK_PATTERN = /[\r\n\u2028\u2029]/u;

const GRAPHQL_PAGE_SIZE = 100;
const REVIEW_PAGE_LIMIT = 10;

const VERDICT_BY_REVIEW_STATE: ReadonlyMap<string, ShadowStatusVerdict> = new Map([
    ['APPROVED', 'approved'],
    ['CHANGES_REQUESTED', 'changes-requested'],
]);

const STATE_BY_VERDICT: ReadonlyMap<ShadowStatusVerdict, ShadowStatusState> = new Map([
    ['approved', 'success'],
    ['changes-requested', 'failure'],
]);

function describeValue(value: unknown): string {
    return JSON.stringify(value) ?? typeof value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return isRecord(value);
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
    return Array.isArray(value);
}

/**
 * A caller that sends an unknown key is refused before anything reads a value: a field outside the
 * allowlist is not part of this fact, whatever it is named. The known forbidden fields are checked
 * first so the refusal says which claim was sent rather than only that something was.
 */
function refuseForeignKeys(input: Record<string, unknown>): void {
    for (const key of Object.keys(input)) {
        if (FORBIDDEN_KEYS.has(key)) {
            fail(`review shadow status refuses forbidden key ${key}`);
        }
        if (!STATUS_KEYS.has(key)) {
            fail(`review shadow status refuses unknown key ${key}`);
        }
    }
}

function requireStatusKeys(input: Record<string, unknown>): void {
    for (const key of STATUS_KEYS) {
        if (!Object.hasOwn(input, key)) {
            fail(`review shadow status is missing required key ${key}`);
        }
    }
}

function readFormat(value: unknown): 'review-shadow-v1' {
    if (value !== SHADOW_STATUS_FORMAT) {
        fail(`review shadow status format must be ${SHADOW_STATUS_FORMAT}, found ${describeValue(value)}`);
    }
    return value;
}

function readVerdict(value: unknown): ShadowStatusVerdict {
    if (value !== 'approved' && value !== 'changes-requested') {
        fail(`review shadow status verdict must be approved or changes-requested, found ${describeValue(value)}`);
    }
    return value;
}

function readPositiveInteger(label: string, value: unknown): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
        fail(`review shadow status ${label} must be a positive safe integer, found ${describeValue(value)}`);
    }
    return value;
}

function readHeadSha(label: string, value: unknown): string {
    if (typeof value !== 'string' || !HEAD_SHA_PATTERN.test(value)) {
        fail(`review shadow status ${label} must be 40 lowercase hex characters, found ${describeValue(value)}`);
    }
    return value;
}

/**
 * Validates one untrusted object as this status fact. Every refusal is a guard clause that throws
 * through the repository's `fail`, so a caller cannot mistake a partially built status for a status.
 */
export function buildReviewShadowStatus(input: unknown): ReviewShadowStatusPayload {
    if (!isPlainObject(input)) {
        fail(`review shadow status input must be a JSON object, found ${describeValue(input)}`);
    }
    refuseForeignKeys(input);
    requireStatusKeys(input);
    const format = readFormat(input.format);
    const pr = readPositiveInteger('pr', input.pr);
    const headSha = readHeadSha('headSha', input.headSha);
    const reviewId = readPositiveInteger('reviewId', input.reviewId);
    const reviewHeadSha = readHeadSha('reviewHeadSha', input.reviewHeadSha);
    if (reviewHeadSha !== headSha) {
        fail(
            `review shadow status refuses reviewHeadSha ${reviewHeadSha}: the review binds head ${headSha}, not this one`
        );
    }
    const verdict = readVerdict(input.verdict);
    return { format, pr, headSha, reviewId, reviewHeadSha, verdict };
}

/**
 * The single line a commit status carries: `<format> <head-sha> <review-id> <verdict>`. It composes
 * from its own typed fields alone and never truncates, because a truncated status still reads as a
 * complete claim; a fact too long or wrapped for one line refuses instead.
 */
export function renderShadowStatusDescription(payload: ReviewShadowStatusPayload): string {
    if (LINE_BREAK_PATTERN.test(payload.headSha) || LINE_BREAK_PATTERN.test(payload.verdict)) {
        fail('review shadow status description must be one line');
    }
    const line = `${payload.format} ${payload.headSha} ${String(payload.reviewId)} ${payload.verdict}`;
    if (line.length > MAX_DESCRIPTION_LENGTH) {
        fail(
            `review shadow status description is ${String(line.length)} characters; maximum is ${String(MAX_DESCRIPTION_LENGTH)}`
        );
    }
    return line;
}

/** The commit-status state a verdict carries. The mapping is total: every verdict has exactly one state. */
export function shadowStatusState(verdict: ShadowStatusVerdict): ShadowStatusState {
    const state = STATE_BY_VERDICT.get(verdict);
    if (state === undefined) {
        fail(`review shadow status has no commit-status state for verdict ${describeValue(verdict)}`);
    }
    return state;
}

/** The short head a receipt names: the seven characters GitHub itself abbreviates a commit to. */
export function shortHead(head: string): string {
    if (!HEAD_SHA_PATTERN.test(head)) {
        fail(`review shadow status receipt head must be 40 lowercase hex characters, found ${describeValue(head)}`);
    }
    return head.slice(0, 7);
}

/**
 * The newest reviewer-App review on exactly this head. A review on another commit is not a fact about
 * this one — an approval for a previous head must not decorate this status — so reviews on other
 * commits are skipped rather than allowed to stand in. A review that is neither an approval nor a
 * change request carries no verdict this status can state and is left to the caller to refuse.
 */
export function selectReviewOnHead(reviews: readonly ReviewerReview[], head: string): ReviewerReview | undefined {
    const onHead = reviews.filter((review) => review.commit === head);
    return onHead.at(-1);
}

/**
 * One commit status as the reviewer App, or a refusal before any write. Each refusal is a distinct
 * fact this command exists to protect: a moved head is another commit, a required shadow context
 * would make the shadow authoritative rather than a shadow, and a review on another commit says
 * nothing about this head.
 */
export function emitReviewShadowStatus(number: number, head: string, port: ReviewShadowStatusPort): string {
    const live = port.pullRequestHead(number);
    if (live !== head) {
        fail(`head moved: ${live} is not ${head}`);
    }
    if (port.shadowContextRequired()) {
        fail(`refusing to post shadow status ${SHADOW_STATUS_CONTEXT}: the live main ruleset requires that context`);
    }
    const review = selectReviewOnHead(port.reviewerReviews(number), head);
    if (review === undefined) {
        fail(`refusing to post shadow status: the reviewer App has no review on head ${head}`);
    }
    const payload = buildReviewShadowStatus({
        format: SHADOW_STATUS_FORMAT,
        pr: number,
        headSha: head,
        reviewId: review.id,
        reviewHeadSha: review.commit,
        verdict: review.verdict,
    });
    const description = renderShadowStatusDescription(payload);
    port.postShadowStatus(head, description, shadowStatusState(payload.verdict));
    const receipt = `review-shadow-status:${String(number)}:${shortHead(head)}:${String(payload.reviewId)}:${payload.verdict}`;
    port.log(receipt);
    return receipt;
}

export function parseReviewShadowStatusArgs(args: string[]): ReviewShadowStatusArgs {
    if (args[0] === '--help') {
        if (args.length !== 1) {
            fail('--help takes no other arguments');
        }
        return { help: true };
    }
    const [number, headFlag, head] = args;
    if (
        args.length !== 3 ||
        headFlag !== '--head' ||
        number === undefined ||
        head === undefined ||
        !DECIMAL_PATTERN.test(number) ||
        !FORTY_HEX_PATTERN.test(head)
    ) {
        fail(SHADOW_STATUS_USAGE);
    }
    const parsed = Number(number);
    if (!Number.isSafeInteger(parsed)) {
        fail(SHADOW_STATUS_USAGE);
    }
    return { number: parsed, head, help: false };
}

/**
 * The review connection this command reads. `fullDatabaseId` is the numeric review id the payload
 * carries; the node `id` is GitHub's opaque string and only names the review in diagnostics. Reviews
 * are read newest-last, the order the connection already returns, so the newest review on the head is
 * the one selected without a second ordering key.
 */
export function reviewerReviewsQuery(): string {
    const reviews = `reviews(last:${String(GRAPHQL_PAGE_SIZE)},before:$before)`;
    const reviewFields = `nodes{id fullDatabaseId state commit{oid} author{__typename ... on Bot{id}}} pageInfo{hasPreviousPage startCursor}`;
    const pullRequest = `pullRequest(number:$number){${reviews}{${reviewFields}}}`;
    return `query($owner:String!,$name:String!,$number:Int!,$before:String){repository(owner:$owner,name:$name){${pullRequest}}}`;
}

type Gh = (args: string[]) => string;

/**
 * The GraphQL envelope's `data`. A response with neither an object `data` nor `errors` is not an
 * envelope this reader can interpret, and an object `data` is the only shape the readers index.
 */
function readGraphqlData(value: unknown, label: string): Record<string, unknown> {
    if (!isRecord(value) || !isRecord(value.data)) {
        fail(`${label} returned an invalid GraphQL envelope`);
    }
    return value.data;
}

function graphql(gh: Gh, query: string, fields: string[], label: string): Record<string, unknown> {
    return readGraphqlData(
        parseGraphqlResponse(gh(['api', 'graphql', '-f', `query=${query}`, ...fields]), label),
        label
    );
}

function readPullRequestNode(data: Record<string, unknown>, label: string): Record<string, unknown> {
    const repository = data.repository;
    const pullRequest = isRecord(repository) ? repository.pullRequest : undefined;
    if (!isRecord(pullRequest)) {
        fail(`${label} is not a readable pull request`);
    }
    return pullRequest;
}

type RepositoryFields = { repository: string; arguments: string[] };

/** The repository is fixed for the run, so its owner and name are resolved once per port. */
function repositoryFields(gh: Gh): RepositoryFields {
    const nameWithOwner = gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
    const [owner, name] = nameWithOwner.split('/');
    if (owner === undefined || name === undefined || owner === '' || name === '') {
        fail(`repository name ${nameWithOwner} is not owner/name`);
    }
    return { repository: `${owner}/${name}`, arguments: ['-f', `owner=${owner}`, '-f', `name=${name}`] };
}

function readJson<Value>(value: string, label: string): Value {
    try {
        return JSON.parse(value) as Value;
    } catch (error) {
        throw new Error(`${label} returned invalid JSON`, { cause: error });
    }
}

function readReviewState(node: Record<string, unknown>, label: string): ShadowStatusVerdict | undefined {
    if (typeof node.state !== 'string') {
        fail(`${label} carries an unreadable review state`);
    }
    return VERDICT_BY_REVIEW_STATE.get(node.state);
}

function readReviewId(node: Record<string, unknown>, label: string): number {
    const value = node.fullDatabaseId;
    if (typeof value !== 'string' || !DECIMAL_PATTERN.test(value)) {
        fail(`${label} must carry a numeric fullDatabaseId, found ${describeValue(value)}`);
    }
    const id = Number(value);
    if (!Number.isSafeInteger(id)) {
        fail(`${label} fullDatabaseId is not a safe integer`);
    }
    return id;
}

function readReviewCommit(node: Record<string, unknown>, label: string): string {
    const commit = node.commit;
    if (!isRecord(commit) || typeof commit.oid !== 'string' || !HEAD_SHA_PATTERN.test(commit.oid)) {
        fail(`${label} must name the 40-hex commit it reviewed`);
    }
    return commit.oid;
}

function isReviewerBot(author: unknown): boolean {
    if (!isRecord(author) || author.__typename !== 'Bot') {
        return false;
    }
    const id = author.id;
    return typeof id === 'string' && isReviewerBotNodeId(id);
}

function readReviewNode(node: unknown, label: string): ReviewerReview | undefined {
    if (!isRecord(node)) {
        fail(`${label} is not a readable pull request review`);
    }
    if (!isReviewerBot(node.author)) {
        return undefined;
    }
    const verdict = readReviewState(node, label);
    if (verdict === undefined) {
        return undefined;
    }
    return { id: readReviewId(node, label), commit: readReviewCommit(node, label), verdict };
}

type ReviewsPage = { reviews: ReviewerReview[]; hasPreviousPage: boolean; startCursor: string | null };

function readReviewsPage(pullRequest: unknown, label: string): ReviewsPage {
    if (!isRecord(pullRequest) || !isRecord(pullRequest.reviews)) {
        fail(`${label} is not a readable pull request`);
    }
    const connection = pullRequest.reviews;
    if (!isUnknownArray(connection.nodes) || !isRecord(connection.pageInfo)) {
        fail(`${label} carries no review connection`);
    }
    const pageInfo = connection.pageInfo;
    if (typeof pageInfo.hasPreviousPage !== 'boolean') {
        fail(`${label} returned an unreadable review page`);
    }
    return {
        reviews: connection.nodes
            .map((node) => readReviewNode(node, label))
            .filter((review): review is ReviewerReview => review !== undefined),
        hasPreviousPage: pageInfo.hasPreviousPage,
        startCursor: typeof pageInfo.startCursor === 'string' ? pageInfo.startCursor : null,
    };
}

/**
 * The reviewer App's reviews, oldest-first. The connection returns the newest page last, so the pages
 * walked backwards are reversed before the caller takes the newest matching one; the walk is bounded
 * because a review past the bound is a pull request this command refuses rather than one it reads
 * forever.
 */
export function readReviewerReviews(pr: number, gh: Gh, fields: string[]): ReviewerReview[] {
    const label = `PR #${pr} reviews`;
    const pages: ReviewerReview[][] = [];
    const seen = new Set<string>();
    let cursor: string | null = null;
    let pagesRead = 0;
    for (;;) {
        if (pagesRead >= REVIEW_PAGE_LIMIT) {
            fail(`cannot prove the reviewer's shadow review state for PR #${pr}`);
        }
        const input = [...fields, '-F', `number=${pr}`];
        if (cursor !== null) {
            input.push('-f', `before=${cursor}`);
        }
        const data = graphql(gh, reviewerReviewsQuery(), input, label);
        const page = readReviewsPage(readPullRequestNode(data, label), label);
        pages.push(page.reviews);
        pagesRead += 1;
        if (!page.hasPreviousPage) {
            return pages.reverse().flat();
        }
        const next = page.startCursor;
        if (next === null || next === '' || seen.has(next)) {
            fail(`${label} returned invalid review pagination`);
        }
        seen.add(next);
        cursor = next;
    }
}

export function readPullRequestHead(pr: number, gh: Gh, fields: string[]): string {
    const label = `PR #${pr} head`;
    const query = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){headRefOid}}}`;
    const data = graphql(gh, query, [...fields, '-F', `number=${pr}`], label);
    const head = readPullRequestNode(data, label).headRefOid;
    if (typeof head !== 'string' || !HEAD_SHA_PATTERN.test(head)) {
        fail(`${label} is not a readable pull request head`);
    }
    return head;
}

/**
 * The union of every `required_status_checks` context the live `main` ruleset applies, read through
 * the same branch-rules endpoint the delivery tooling merges against. A missing or malformed rule has
 * not said that nothing is required, so it fails the read rather than reading as an empty requirement:
 * a shadow status is only safe to post when the ruleset explicitly does not require its context.
 */
export function readRulesetRequiredContexts(repository: string, gh: Gh): string[] {
    const label = `branch ruleset for ${repository}`;
    const rules = readJson<unknown>(gh(['api', `repos/${repository}/rules/branches/main`]), label);
    if (!isUnknownArray(rules)) {
        fail(`${label} is not a readable rule list`);
    }
    const rulesRecords = rules.filter(isRecord);
    if (rulesRecords.length !== rules.length) {
        fail(`${label} carries an unreadable rule`);
    }
    const requiredStatusCheckRules = rulesRecords.filter((rule) => rule.type === 'required_status_checks');
    if (requiredStatusCheckRules.length === 0) {
        fail(`${label} carries no required_status_checks rule with a parameters array`);
    }
    const contexts: string[] = [];
    for (const rule of requiredStatusCheckRules) {
        const parameters = rule.parameters;
        if (!isRecord(parameters) || !isUnknownArray(parameters.required_status_checks)) {
            fail(`${label} carries a required_status_checks rule with no parameters array`);
        }
        for (const check of parameters.required_status_checks) {
            if (!isRecord(check) || typeof check.context !== 'string') {
                fail(`${label} carries a required status check with no context`);
            }
            contexts.push(check.context);
        }
    }
    return [...new Set(contexts)];
}

export function postCommitStatus(
    head: string,
    description: string,
    state: ShadowStatusState,
    repository: string,
    gh: Gh
): void {
    const label = `commit status for ${head}`;
    const response = readJson<unknown>(
        gh([
            'api',
            `repos/${repository}/statuses/${head}`,
            '--method',
            'POST',
            '-f',
            `state=${state}`,
            '-f',
            `context=${SHADOW_STATUS_CONTEXT}`,
            '-f',
            `description=${description}`,
        ]),
        label
    );
    if (
        !isRecord(response) ||
        response.context !== SHADOW_STATUS_CONTEXT ||
        response.description !== description ||
        response.state !== state ||
        response.sha !== head
    ) {
        fail(`commit status for ${head} was not recorded as requested`);
    }
}

/**
 * Authenticates the reviewer role through its own mint set. Posting a commit status needs
 * `statuses: write`, which the reviewer publication mint deliberately omits, so this command must
 * never fall back to the default set.
 */
export async function authenticateShadowReviewer(
    primaryRoot: string,
    readFile?: FileReader,
    request?: GitHubJsonClient,
    env?: NodeJS.ProcessEnv
): Promise<ReviewShadowStatusAuthentication> {
    const auth = await authenticateRole({
        primaryRoot,
        role: 'reviewer',
        permissions: SHADOW_REVIEWER_MINT_PERMISSIONS,
        readFile,
        request,
        env,
    });
    return { minted: auth.minted, session: auth.session };
}

export function shellPort(
    session: GhSession,
    cwd: string = process.cwd(),
    capture: typeof spawnCapture = spawnCapture
): ReviewShadowStatusPort {
    const primaryRoot = resolvePrimaryRoot(
        (command, args, directory) => capture(command, args, { cwd: directory }),
        cwd
    );
    const gh = (args: string[]) => capture('gh', args, { cwd: primaryRoot, env: session.env });
    const { repository, arguments: fields } = repositoryFields(gh);
    return {
        pullRequestHead: (pr) => readPullRequestHead(pr, gh, fields),
        reviewerReviews: (pr) => readReviewerReviews(pr, gh, fields),
        shadowContextRequired: () => readRulesetRequiredContexts(repository, gh).includes(SHADOW_STATUS_CONTEXT),
        postShadowStatus: (head, description, state) => postCommitStatus(head, description, state, repository, gh),
        log: (message) => {
            console.log(message);
        },
    };
}

export function defaultReviewShadowStatusCoordinatorDependencies(): ReviewShadowStatusCoordinatorDependencies {
    return {
        primaryRoot: () => resolvePrimaryRoot(),
        authenticateReviewer: authenticateShadowReviewer,
        repositoryName: (session, primaryRoot) =>
            spawnCapture('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], {
                env: session.env,
                cwd: primaryRoot,
            }),
        port: (session, primaryRoot) => shellPort(session, primaryRoot, spawnCapture),
        emit: emitReviewShadowStatus,
    };
}

export async function coordinateReviewShadowStatus(
    number: number,
    head: string,
    dependencies: ReviewShadowStatusCoordinatorDependencies = defaultReviewShadowStatusCoordinatorDependencies()
): Promise<string> {
    const primaryRoot = dependencies.primaryRoot();
    const auth = await dependencies.authenticateReviewer(primaryRoot);
    try {
        if (!isReviewerBotNodeId(auth.minted.actorNodeId)) {
            fail(`minted actor ${auth.minted.actorNodeId} is not ${REVIEWER_BOT_NODE_ID}`);
        }
        assertRequiredRepository(dependencies.repositoryName(auth.session, primaryRoot));
        return dependencies.emit(number, head, dependencies.port(auth.session, primaryRoot));
    } finally {
        auth.session.dispose();
    }
}

export async function runReviewShadowStatusCli(
    args: string[],
    dependencies?: ReviewShadowStatusCoordinatorDependencies
): Promise<number> {
    const parsed = parseReviewShadowStatusArgs(args);
    if (parsed.help) {
        console.log(`Usage: ${SHADOW_STATUS_USAGE.slice('usage: '.length)}`);
        return 0;
    }
    if (parsed.number === undefined || parsed.head === undefined) {
        fail(SHADOW_STATUS_USAGE);
    }
    await coordinateReviewShadowStatus(parsed.number, parsed.head, dependencies);
    return 0;
}
