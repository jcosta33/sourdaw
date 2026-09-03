#!/usr/bin/env node
/**
 * Answers the one question the daily web train asks before it deploys: does
 * the revision it just validated belong ahead of what production already
 * serves?
 *
 * The train validates `main`'s head and then promotes that exact revision.
 * When production already serves it, a second deployment would ship a
 * byte-identical tree under a new deployment id, so the train reports a
 * no-op instead. When production serves something else, equality is not
 * enough to decide: the deploy queue is ordered by when each run's
 * validation legs finished, not by commit order, and a re-run replays its
 * original run's SHA — so an older revision can be next in line behind a
 * newer one that already deployed. Promoting it would be a rollback nobody
 * asked for. The ancestry between the served revision and the candidate is
 * what tells the two cases apart: a served revision that is an ancestor of
 * the candidate is simply older, and the candidate deploys; a served
 * revision the candidate does not descend from — a descendant of the
 * candidate instead (GitHub answers `behind`), or on a divergent history
 * entirely (`diverged`) — must not be overwritten, and the train refuses.
 *
 * The comparison reads the newest READY production deployment and the commit
 * revision the train recorded on it (`vercel deploy --meta githubCommitSha`),
 * then asks GitHub whether the candidate descends from it. A served revision
 * that cannot be read, or an ancestry GitHub cannot answer (the served
 * revision is unknown to the repository), is treated the same way: deploying
 * the same or an equivalent tree twice is recoverable, and refusing to
 * deploy a tree that actually changed is the failure this train exists to
 * prevent.
 *
 * Reading production state is not optional, though. A query that fails exits
 * non-zero rather than guessing, because a guess in either direction is a
 * deployment decision nobody observed.
 */

import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

type ProductionDeploymentScope = {
    readonly projectId: string;
    readonly orgId: string;
};

/**
 * A revision string proved to be a commit id — forty lowercase hex characters
 * and nothing else. The brand exists so that only `readDeployedRevision` and
 * `requireCommitRevision` can produce one: one value comes out of an API
 * answer nobody here controls and the other out of the environment, and both
 * end up in a URL or in `GITHUB_OUTPUT`, whose line-oriented format makes any
 * embedded newline a way to define further workflow outputs.
 */
export type ValidatedRevision = string & { readonly revisionShape: 'forty lowercase hex characters' };

/**
 * GitHub's own vocabulary for how one commit relates to another on the
 * compare endpoint: `ahead` when the head descends from the base, `behind`
 * when the base descends from the head, `identical` when they are the same
 * commit, and `diverged` when neither descends from the other.
 */
export type RevisionComparison = 'ahead' | 'behind' | 'identical' | 'diverged';

/**
 * `deploy` promotes the candidate. `serving` means production already serves
 * it — a byte-identical no-op. `stale` means production serves a revision the
 * candidate does not descend from, so promoting the candidate would be a
 * rollback.
 */
export type TrainReason = 'deploy' | 'serving' | 'stale';

export type ProductionTrainDecision = {
    readonly deploy: boolean;
    readonly reason: TrainReason;
    readonly deployedRevision: ValidatedRevision | null;
};

const DEPLOYMENTS_ENDPOINT = 'https://api.vercel.com/v7/deployments';
const TEAM_SCOPE_PREFIX = 'team_';
const COMMIT_REVISION = /^[0-9a-f]{40}$/u;
const COMPARE_API_VERSION = '2022-11-28';
const REVISION_COMPARISONS: readonly string[] = ['ahead', 'behind', 'identical', 'diverged'];

function isRevisionComparison(value: string): value is RevisionComparison {
    return REVISION_COMPARISONS.includes(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, unknown>;
}

function requireEnvironment(name: string): string {
    const value = process.env[name];
    if (value === undefined || value === '') {
        throw new Error(`${name} must be set to resolve the current production deployment`);
    }
    return value;
}

/**
 * Vercel scopes a query to a team through `teamId`. A personal account's
 * organisation id is a user id instead, which that parameter rejects, so only a
 * team scope belongs on the query string.
 */
export function buildProductionDeploymentUrl(scope: ProductionDeploymentScope): string {
    const url = new URL(DEPLOYMENTS_ENDPOINT);
    url.searchParams.set('projectId', scope.projectId);
    url.searchParams.set('target', 'production');
    url.searchParams.set('state', 'READY');
    url.searchParams.set('limit', '1');
    if (scope.orgId.startsWith(TEAM_SCOPE_PREFIX)) {
        url.searchParams.set('teamId', scope.orgId);
    }
    return url.toString();
}

function isCommitRevision(value: string): value is ValidatedRevision {
    return COMMIT_REVISION.test(value);
}

/**
 * Proves an environment-supplied revision is a commit id before it reaches a
 * URL. `CANDIDATE_REVISION` comes from `github.sha`, which is trustworthy in
 * practice, but nothing downstream should rely on that: an unvalidated value
 * placed in the GitHub compare URL is a path-injection surface.
 */
export function requireCommitRevision(value: string): ValidatedRevision {
    if (!isCommitRevision(value)) {
        throw new Error(`${value} is not a forty-character lowercase-hex commit revision`);
    }
    return value;
}

/**
 * Anything the answer offers that is not a commit id is unreadable, which is
 * the same branch as an absent one: the train deploys rather than trusting a
 * comparison it could not make.
 */
export function readDeployedRevision(payload: unknown): ValidatedRevision | null {
    const deployments = asRecord(payload)?.deployments;
    if (!Array.isArray(deployments)) {
        return null;
    }
    const revision = asRecord(asRecord(deployments[0])?.meta)?.githubCommitSha;
    if (typeof revision !== 'string' || !isCommitRevision(revision)) {
        return null;
    }
    return revision;
}

/**
 * The pure decision at the centre of the train: given what production
 * serves and how the candidate relates to it, decide whether to deploy.
 *
 * A null served revision is unreadable, and an unreadable revision deploys —
 * the existing policy, preserved. A null comparison with a readable served
 * revision means the ancestry itself could not be answered (GitHub does not
 * know the served revision, or it was never asked because there was nothing
 * to compare against an unreadable revision); that is treated the same way,
 * because refusing to deploy a tree that actually changed is the failure
 * this train exists to prevent, and deploying a tree that was already there
 * is recoverable.
 */
export function decideTrain(
    deployedRevision: ValidatedRevision | null,
    comparison: RevisionComparison | null
): ProductionTrainDecision {
    if (deployedRevision === null || comparison === null) {
        return { deploy: true, reason: 'deploy', deployedRevision };
    }
    switch (comparison) {
        case 'identical':
            return { deploy: false, reason: 'serving', deployedRevision };
        case 'ahead':
            return { deploy: true, reason: 'deploy', deployedRevision };
        case 'behind':
        case 'diverged':
            return { deploy: false, reason: 'stale', deployedRevision };
        default: {
            const unreachable: never = comparison;
            throw new Error(`the revision comparison answered an unhandled status: ${String(unreachable)}`);
        }
    }
}

/**
 * The URL for GitHub's three-dot compare of two revisions: whether `head`
 * descends from `base`, the other way around, neither, or they are the same
 * commit. `base` is proved a commit id before it arrives here; `head` is the
 * candidate, validated by its caller for the same reason.
 */
export function buildCompareUrl(repository: string, base: ValidatedRevision, head: string): string {
    return `https://api.github.com/repos/${repository}/compare/${base}...${head}`;
}

/**
 * Parses the compare endpoint's `status` field into one of the four ancestry
 * relationships GitHub reports. Anything else — a missing field, a string
 * outside the known set — is unreadable, the same branch as a query GitHub
 * refused outright.
 */
export function readComparisonStatus(payload: unknown): RevisionComparison {
    const status = asRecord(payload)?.status;
    if (typeof status !== 'string' || !isRevisionComparison(status)) {
        throw new Error('the revision comparison answered an unknown status');
    }
    return status;
}

async function readProductionDeployments(url: string, token: string): Promise<unknown> {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) {
        throw new Error(`the production deployment query answered ${String(response.status)}`);
    }
    return await response.json();
}

/**
 * Asks GitHub whether `candidate` descends from `served`. A 404 means the
 * served revision is unknown to the repository — unreachable through no
 * fault of the candidate's, such as a deployment recorded against a
 * force-pushed or otherwise vanished commit — and is treated exactly like an
 * unreadable served revision, so the train deploys rather than refusing
 * blind. Any other failure to answer is not swallowed the same way: it
 * throws, because a comparison GitHub could have made but did not is not
 * evidence of anything.
 */
async function compareRevisions(
    repository: string,
    token: string,
    served: ValidatedRevision,
    candidate: string
): Promise<RevisionComparison | null> {
    const response = await fetch(buildCompareUrl(repository, served, candidate), {
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': COMPARE_API_VERSION,
        },
    });
    if (response.status === 404) {
        return null;
    }
    if (!response.ok) {
        throw new Error(`the revision comparison answered ${String(response.status)}`);
    }
    return readComparisonStatus(await response.json());
}

export async function resolveProductionTrain(candidateRevision: string): Promise<ProductionTrainDecision> {
    const candidate = requireCommitRevision(candidateRevision);
    const url = buildProductionDeploymentUrl({
        projectId: requireEnvironment('VERCEL_PROJECT_ID'),
        orgId: requireEnvironment('VERCEL_ORG_ID'),
    });
    const payload = await readProductionDeployments(url, requireEnvironment('VERCEL_TOKEN'));
    const deployedRevision = readDeployedRevision(payload);
    if (deployedRevision === null) {
        return decideTrain(null, null);
    }
    // Equal revisions need no ancestry answer, and skipping the request keeps
    // the common case — a re-run of a train that already deployed today —
    // from spending a GitHub call on a question equality already answered.
    if (deployedRevision === candidate) {
        return decideTrain(deployedRevision, 'identical');
    }
    const comparison = await compareRevisions(
        requireEnvironment('GITHUB_REPOSITORY'),
        requireEnvironment('GITHUB_TOKEN'),
        deployedRevision,
        candidate
    );
    return decideTrain(deployedRevision, comparison);
}

export function reportDecision(decision: ProductionTrainDecision, candidateRevision: string): void {
    // `GITHUB_OUTPUT` receives only literals chosen by the decision. Nothing
    // derived from an API answer reaches a workflow file: the file is
    // line-oriented, so a value carrying a newline would define further
    // outputs — including the `deploy` and `reason` the next steps read. The
    // served revision belongs in the log below, which no workflow step
    // parses.
    appendFileSync(
        requireEnvironment('GITHUB_OUTPUT'),
        `deploy=${decision.deploy ? 'true' : 'false'}\nreason=${decision.reason}\n`
    );
    switch (decision.reason) {
        case 'serving':
            console.log(`production already serves ${candidateRevision}; the train has nothing to deploy`);
            return;
        case 'stale':
            console.log(
                `production serves ${decision.deployedRevision ?? 'no readable revision'}, which the candidate ` +
                    `${candidateRevision} does not descend from; the train deploys nothing`
            );
            return;
        case 'deploy':
            console.log(
                `production serves ${decision.deployedRevision ?? 'no readable revision'}; ` +
                    `the train will deploy ${candidateRevision}`
            );
            return;
    }
}

async function main(): Promise<void> {
    const candidateRevision = requireEnvironment('CANDIDATE_REVISION');
    reportDecision(await resolveProductionTrain(candidateRevision), candidateRevision);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main().catch((error: unknown) => {
        console.error(`the daily web train could not resolve the current production deployment: ${String(error)}`);
        process.exit(1);
    });
}
