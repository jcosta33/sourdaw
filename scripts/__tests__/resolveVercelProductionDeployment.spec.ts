/**
 * The daily web train deploys only when the revision it validated is not the one
 * production already serves. Every way that comparison can go wrong ends in one
 * of two outcomes: a deployment that was not needed, or — the one that matters —
 * a changed tree that never reaches users because the train decided it was
 * already there. These cases pin the second outcome to a readable equality and
 * nothing else.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    buildProductionDeploymentUrl,
    readDeployedRevision,
    reportDecision,
    resolveProductionTrain,
    resolveTrainDecision,
} from '../resolveVercelProductionDeployment';

const CANDIDATE = '1111111111111111111111111111111111111111';
const DEPLOYED = '2222222222222222222222222222222222222222';

function deploymentPayload(revision: string): unknown {
    return { deployments: [{ uid: 'dpl_fixture', url: 'sourdaw.vercel.app', meta: { githubCommitSha: revision } }] };
}

function okResponse(payload: unknown): { ok: boolean; status: number; json: () => Promise<unknown> } {
    return { ok: true, status: 200, json: () => Promise.resolve(payload) };
}

describe('the production deployment query', () => {
    it('asks for the newest ready production deployment of the linked project', () => {
        const url = new URL(buildProductionDeploymentUrl({ projectId: 'prj_fixture', orgId: 'user_fixture' }));
        expect(url.origin + url.pathname).toBe('https://api.vercel.com/v7/deployments');
        expect(url.searchParams.get('projectId')).toBe('prj_fixture');
        expect(url.searchParams.get('target')).toBe('production');
        expect(url.searchParams.get('state')).toBe('READY');
        expect(url.searchParams.get('limit')).toBe('1');
    });

    it('scopes the query to a team, and only to a team', () => {
        const team = new URL(buildProductionDeploymentUrl({ projectId: 'prj_fixture', orgId: 'team_fixture' }));
        expect(team.searchParams.get('teamId')).toBe('team_fixture');
        // A personal account's organisation id is a user id; `teamId` rejects it,
        // and a rejected query fails the train rather than deploying blind.
        const personal = new URL(buildProductionDeploymentUrl({ projectId: 'prj_fixture', orgId: 'user_fixture' }));
        expect(personal.searchParams.has('teamId')).toBe(false);
    });
});

describe('the deployed revision', () => {
    it('is the commit recorded on the newest ready production deployment', () => {
        expect(readDeployedRevision(deploymentPayload(DEPLOYED))).toBe(DEPLOYED);
    });

    it('is unreadable when nothing in the answer carries one', () => {
        expect(readDeployedRevision({ deployments: [] })).toBeNull();
        expect(readDeployedRevision({ deployments: [{ uid: 'dpl_fixture' }] })).toBeNull();
        expect(readDeployedRevision({ deployments: [{ meta: {} }] })).toBeNull();
        expect(readDeployedRevision({ deployments: [{ meta: { githubCommitSha: '' } }] })).toBeNull();
        expect(readDeployedRevision({ deployments: [{ meta: { githubCommitSha: 42 } }] })).toBeNull();
        expect(readDeployedRevision({})).toBeNull();
        expect(readDeployedRevision(null)).toBeNull();
        expect(readDeployedRevision('deployments')).toBeNull();
    });
});

describe('the train decision', () => {
    it('skips the revision production already serves', () => {
        expect(resolveTrainDecision(deploymentPayload(CANDIDATE), CANDIDATE)).toEqual({
            deploy: false,
            deployedRevision: CANDIDATE,
        });
    });

    it('deploys a revision production does not serve', () => {
        expect(resolveTrainDecision(deploymentPayload(DEPLOYED), CANDIDATE)).toEqual({
            deploy: true,
            deployedRevision: DEPLOYED,
        });
    });

    it('deploys when the served revision cannot be read at all', () => {
        expect(resolveTrainDecision({ deployments: [] }, CANDIDATE)).toEqual({
            deploy: true,
            deployedRevision: null,
        });
    });
});

describe('the resolved train', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
    });

    function stubCredentials(): void {
        vi.stubEnv('VERCEL_PROJECT_ID', 'prj_fixture');
        vi.stubEnv('VERCEL_ORG_ID', 'team_fixture');
        vi.stubEnv('VERCEL_TOKEN', 'token-fixture');
    }

    it('authenticates the query it built and decides on its answer', async () => {
        stubCredentials();
        const fetchProduction = vi.fn().mockResolvedValue(okResponse(deploymentPayload(CANDIDATE)));
        vi.stubGlobal('fetch', fetchProduction);

        await expect(resolveProductionTrain(CANDIDATE)).resolves.toEqual({
            deploy: false,
            deployedRevision: CANDIDATE,
        });
        expect(fetchProduction).toHaveBeenCalledWith(
            buildProductionDeploymentUrl({ projectId: 'prj_fixture', orgId: 'team_fixture' }),
            { headers: { Authorization: 'Bearer token-fixture' } }
        );
    });

    it('refuses to decide when the query is unanswered or unauthorised', async () => {
        stubCredentials();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));
        await expect(resolveProductionTrain(CANDIDATE)).rejects.toThrow('the production deployment query answered 403');
    });

    it('refuses to decide without the credentials the query needs', async () => {
        vi.stubEnv('VERCEL_PROJECT_ID', '');
        vi.stubEnv('VERCEL_ORG_ID', 'team_fixture');
        vi.stubEnv('VERCEL_TOKEN', 'token-fixture');
        const fetchProduction = vi.fn();
        vi.stubGlobal('fetch', fetchProduction);
        await expect(resolveProductionTrain(CANDIDATE)).rejects.toThrow('VERCEL_PROJECT_ID must be set');
        expect(fetchProduction).not.toHaveBeenCalled();
    });
});

describe('the reported decision', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    function outputOf(decision: Parameters<typeof reportDecision>[0]): string {
        const directory = mkdtempSync(join(tmpdir(), 'sourdaw-vercel-train-'));
        const outputPath = join(directory, 'github-output');
        try {
            vi.stubEnv('GITHUB_OUTPUT', outputPath);
            reportDecision(decision, CANDIDATE);
            return readFileSync(outputPath, 'utf8');
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    }

    it('publishes the decision the deploying steps read', () => {
        expect(outputOf({ deploy: true, deployedRevision: DEPLOYED })).toBe(
            `deploy=true\ndeployed-revision=${DEPLOYED}\n`
        );
        expect(outputOf({ deploy: false, deployedRevision: CANDIDATE })).toBe(
            `deploy=false\ndeployed-revision=${CANDIDATE}\n`
        );
        expect(outputOf({ deploy: true, deployedRevision: null })).toBe('deploy=true\ndeployed-revision=\n');
    });
});
