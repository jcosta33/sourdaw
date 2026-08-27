#!/usr/bin/env node
/**
 * Answers the one question the daily web train asks before it deploys: is the
 * revision it just validated already the one production serves?
 *
 * The train validates `main`'s head and then promotes that exact revision. When
 * production already serves it, a second deployment would ship a byte-identical
 * tree under a new deployment id, so the train reports a no-op instead.
 *
 * The comparison reads the newest READY production deployment and the commit
 * revision the train recorded on it (`vercel deploy --meta githubCommitSha`).
 * A revision that cannot be read is treated as different from the candidate:
 * deploying the same tree twice is recoverable, and not deploying a tree that
 * changed is the failure this train exists to prevent.
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
 * and nothing else. The brand exists so that only `readDeployedRevision` can
 * produce one: the value comes out of an API answer nobody here controls, and
 * it ends up in `GITHUB_OUTPUT`, whose line-oriented format makes any embedded
 * newline a way to define further workflow outputs.
 */
export type ValidatedRevision = string & { readonly revisionShape: 'forty lowercase hex characters' };

export type ProductionTrainDecision = {
    readonly deploy: boolean;
    readonly deployedRevision: ValidatedRevision | null;
};

const DEPLOYMENTS_ENDPOINT = 'https://api.vercel.com/v7/deployments';
const TEAM_SCOPE_PREFIX = 'team_';
const COMMIT_REVISION = /^[0-9a-f]{40}$/u;

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

export function resolveTrainDecision(payload: unknown, candidateRevision: string): ProductionTrainDecision {
    const deployedRevision = readDeployedRevision(payload);
    return { deployedRevision, deploy: deployedRevision !== candidateRevision };
}

async function readProductionDeployments(url: string, token: string): Promise<unknown> {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) {
        throw new Error(`the production deployment query answered ${String(response.status)}`);
    }
    return await response.json();
}

export async function resolveProductionTrain(candidateRevision: string): Promise<ProductionTrainDecision> {
    const url = buildProductionDeploymentUrl({
        projectId: requireEnvironment('VERCEL_PROJECT_ID'),
        orgId: requireEnvironment('VERCEL_ORG_ID'),
    });
    const payload = await readProductionDeployments(url, requireEnvironment('VERCEL_TOKEN'));
    return resolveTrainDecision(payload, candidateRevision);
}

export function reportDecision(decision: ProductionTrainDecision, candidateRevision: string): void {
    // `GITHUB_OUTPUT` is line-oriented: a value carrying a newline defines
    // further outputs, so what is written here has to be single-line by
    // construction. Only a `ValidatedRevision` or the empty string can reach
    // this call, which is why the shape is proved where the value is parsed
    // rather than re-checked here.
    appendFileSync(
        requireEnvironment('GITHUB_OUTPUT'),
        `deploy=${String(decision.deploy)}\ndeployed-revision=${decision.deployedRevision ?? ''}\n`
    );
    if (!decision.deploy) {
        console.log(`production already serves ${candidateRevision}; the train has nothing to deploy`);
        return;
    }
    console.log(
        `production serves ${decision.deployedRevision ?? 'no readable revision'}; ` +
            `the train will deploy ${candidateRevision}`
    );
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
