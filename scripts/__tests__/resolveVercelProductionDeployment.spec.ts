/**
 * The daily web train deploys only when the revision it validated belongs
 * ahead of what production already serves. Equality is the easy case — a
 * byte-identical no-op — but the deploy queue is ordered by when each run's
 * validation legs finished, not by commit order, so a served revision that
 * differs from the candidate can still be *ahead* of it: promoting the
 * candidate then would be a rollback. Every way the ancestry decision can go
 * wrong ends in one of two outcomes: a deployment that was not needed, or —
 * the one that matters — a changed tree that never reaches users because the
 * train mistook a real advance for a rollback. These cases pin that decision
 * to a readable ancestry answer and nothing else.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    buildCompareUrl,
    buildProductionDeploymentUrl,
    decideTrain,
    readComparisonStatus,
    readDeployedRevision,
    reportDecision,
    requireCommitRevision,
    resolveProductionTrain,
    type ProductionTrainDecision,
} from '../resolveVercelProductionDeployment';

// Hex with letters in it, so that the uppercase case below is a real case.
const CANDIDATE = '1a'.repeat(20);
const DEPLOYED = '2b'.repeat(20);
const REPOSITORY = 'jcosta33/sourdaw';
// What a compromised or merely wrong answer can carry. `GITHUB_OUTPUT` is
// line-oriented, so the newline is the whole attack: written unvalidated, the
// second line would define `deploy` and send the train past its own decision.
const INJECTION_PAYLOAD = `${DEPLOYED}\ndeploy=true\nsomething=else`;
const NON_HEX_REVISIONS = ['not-a-revision', DEPLOYED.toUpperCase(), `${DEPLOYED}0`, DEPLOYED.slice(0, 39)];

function deploymentPayload(revision: string): unknown {
    return { deployments: [{ uid: 'dpl_fixture', url: 'sourdaw.vercel.app', meta: { githubCommitSha: revision } }] };
}

function okResponse(payload: unknown): { ok: boolean; status: number; json: () => Promise<unknown> } {
    return { ok: true, status: 200, json: () => Promise.resolve(payload) };
}

function notFoundResponse(): { ok: boolean; status: number; json: () => Promise<unknown> } {
    return { ok: false, status: 404, json: () => Promise.resolve({ message: 'Not Found' }) };
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

    it('is unreadable when the answer carries something that is not a commit id', () => {
        expect(readDeployedRevision(deploymentPayload(INJECTION_PAYLOAD))).toBeNull();
        for (const revision of NON_HEX_REVISIONS) {
            expect(readDeployedRevision(deploymentPayload(revision))).toBeNull();
        }
    });
});

describe('the required commit revision', () => {
    it('accepts a forty-character lowercase-hex revision', () => {
        expect(requireCommitRevision(CANDIDATE)).toBe(CANDIDATE);
    });

    it('refuses anything that is not one, before it can reach a URL', () => {
        for (const revision of [...NON_HEX_REVISIONS, INJECTION_PAYLOAD]) {
            expect(() => requireCommitRevision(revision)).toThrow(
                `${revision} is not a forty-character lowercase-hex commit revision`
            );
        }
    });
});

describe('the compare url', () => {
    it('three-dot compares the served revision against the candidate on the repository', () => {
        expect(buildCompareUrl(REPOSITORY, requireCommitRevision(DEPLOYED), CANDIDATE)).toBe(
            `https://api.github.com/repos/${REPOSITORY}/compare/${DEPLOYED}...${CANDIDATE}`
        );
    });
});

describe('the comparison status', () => {
    it('is one of the four ancestry relationships GitHub reports', () => {
        for (const status of ['ahead', 'behind', 'identical', 'diverged'] as const) {
            expect(readComparisonStatus({ status })).toBe(status);
        }
    });

    it('is unreadable when the answer names a status GitHub does not define', () => {
        expect(() => readComparisonStatus({ status: 'unrelated' })).toThrow(
            'the revision comparison answered an unknown status'
        );
    });

    it('is unreadable when the answer carries no status at all', () => {
        expect(() => readComparisonStatus({})).toThrow('the revision comparison answered an unknown status');
        expect(() => readComparisonStatus(null)).toThrow('the revision comparison answered an unknown status');
        expect(() => readComparisonStatus('ahead')).toThrow('the revision comparison answered an unknown status');
    });
});

describe('the train decision', () => {
    it('deploys when the served revision cannot be read at all', () => {
        expect(decideTrain(null, null)).toEqual({ deploy: true, reason: 'deploy', deployedRevision: null });
    });

    it('skips a served revision identical to the candidate', () => {
        const served = requireCommitRevision(CANDIDATE);
        expect(decideTrain(served, 'identical')).toEqual({
            deploy: false,
            reason: 'serving',
            deployedRevision: served,
        });
    });

    it('deploys a candidate that is ahead of the served revision', () => {
        const served = requireCommitRevision(DEPLOYED);
        expect(decideTrain(served, 'ahead')).toEqual({ deploy: true, reason: 'deploy', deployedRevision: served });
    });

    it('refuses a served revision the candidate does not descend from', () => {
        const served = requireCommitRevision(DEPLOYED);
        for (const comparison of ['behind', 'diverged'] as const) {
            expect(decideTrain(served, comparison)).toEqual({
                deploy: false,
                reason: 'stale',
                deployedRevision: served,
            });
        }
    });

    it('deploys when the served revision is readable but its ancestry could not be answered', () => {
        const served = requireCommitRevision(DEPLOYED);
        expect(decideTrain(served, null)).toEqual({ deploy: true, reason: 'deploy', deployedRevision: served });
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

    function stubGithub(): void {
        vi.stubEnv('GITHUB_TOKEN', 'gh-token-fixture');
        vi.stubEnv('GITHUB_REPOSITORY', REPOSITORY);
    }

    it('authenticates the deployment query it built and decides on an identical answer', async () => {
        stubCredentials();
        const fetchProduction = vi.fn().mockResolvedValue(okResponse(deploymentPayload(CANDIDATE)));
        vi.stubGlobal('fetch', fetchProduction);

        await expect(resolveProductionTrain(CANDIDATE)).resolves.toEqual({
            deploy: false,
            reason: 'serving',
            deployedRevision: CANDIDATE,
        });
        expect(fetchProduction).toHaveBeenCalledWith(
            buildProductionDeploymentUrl({ projectId: 'prj_fixture', orgId: 'team_fixture' }),
            { headers: { Authorization: 'Bearer token-fixture' } }
        );
    });

    it('does not ask GitHub to compare when production already serves the candidate', async () => {
        stubCredentials();
        const fetchProduction = vi.fn().mockResolvedValue(okResponse(deploymentPayload(CANDIDATE)));
        vi.stubGlobal('fetch', fetchProduction);

        await resolveProductionTrain(CANDIDATE);
        expect(fetchProduction).toHaveBeenCalledTimes(1);
    });

    it('deploys a candidate that is ahead of a different served revision', async () => {
        stubCredentials();
        stubGithub();
        const fetchProduction = vi
            .fn()
            .mockResolvedValueOnce(okResponse(deploymentPayload(DEPLOYED)))
            .mockResolvedValueOnce(okResponse({ status: 'ahead' }));
        vi.stubGlobal('fetch', fetchProduction);

        await expect(resolveProductionTrain(CANDIDATE)).resolves.toEqual({
            deploy: true,
            reason: 'deploy',
            deployedRevision: DEPLOYED,
        });
        expect(fetchProduction).toHaveBeenNthCalledWith(
            2,
            buildCompareUrl(REPOSITORY, requireCommitRevision(DEPLOYED), CANDIDATE),
            {
                headers: {
                    Authorization: 'Bearer gh-token-fixture',
                    Accept: 'application/vnd.github+json',
                    'X-GitHub-Api-Version': '2022-11-28',
                },
            }
        );
    });

    it('refuses a served revision the candidate is behind', async () => {
        stubCredentials();
        stubGithub();
        vi.stubGlobal(
            'fetch',
            vi
                .fn()
                .mockResolvedValueOnce(okResponse(deploymentPayload(DEPLOYED)))
                .mockResolvedValueOnce(okResponse({ status: 'behind' }))
        );

        await expect(resolveProductionTrain(CANDIDATE)).resolves.toEqual({
            deploy: false,
            reason: 'stale',
            deployedRevision: DEPLOYED,
        });
    });

    it('deploys when GitHub no longer recognises the served revision', async () => {
        stubCredentials();
        stubGithub();
        vi.stubGlobal(
            'fetch',
            vi
                .fn()
                .mockResolvedValueOnce(okResponse(deploymentPayload(DEPLOYED)))
                .mockResolvedValueOnce(notFoundResponse())
        );

        await expect(resolveProductionTrain(CANDIDATE)).resolves.toEqual({
            deploy: true,
            reason: 'deploy',
            deployedRevision: DEPLOYED,
        });
    });

    it('refuses to decide when the comparison fails for a reason other than 404', async () => {
        stubCredentials();
        stubGithub();
        vi.stubGlobal(
            'fetch',
            vi
                .fn()
                .mockResolvedValueOnce(okResponse(deploymentPayload(DEPLOYED)))
                .mockResolvedValueOnce({ ok: false, status: 500 })
        );

        await expect(resolveProductionTrain(CANDIDATE)).rejects.toThrow('the revision comparison answered 500');
    });

    it('refuses to decide when the deployment query is unanswered or unauthorised', async () => {
        stubCredentials();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));
        await expect(resolveProductionTrain(CANDIDATE)).rejects.toThrow('the production deployment query answered 403');
    });

    it('refuses to decide without the Vercel credentials the deployment query needs', async () => {
        vi.stubEnv('VERCEL_PROJECT_ID', '');
        vi.stubEnv('VERCEL_ORG_ID', 'team_fixture');
        vi.stubEnv('VERCEL_TOKEN', 'token-fixture');
        const fetchProduction = vi.fn();
        vi.stubGlobal('fetch', fetchProduction);
        await expect(resolveProductionTrain(CANDIDATE)).rejects.toThrow('VERCEL_PROJECT_ID must be set');
        expect(fetchProduction).not.toHaveBeenCalled();
    });

    it('refuses to decide without the GitHub credentials a comparison needs', async () => {
        stubCredentials();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse(deploymentPayload(DEPLOYED))));
        await expect(resolveProductionTrain(CANDIDATE)).rejects.toThrow('GITHUB_REPOSITORY must be set');
    });

    it('refuses a candidate that is not a commit revision before it reaches a URL', async () => {
        stubCredentials();
        const fetchProduction = vi.fn();
        vi.stubGlobal('fetch', fetchProduction);
        await expect(resolveProductionTrain('not-a-revision')).rejects.toThrow(
            'not-a-revision is not a forty-character lowercase-hex commit revision'
        );
        expect(fetchProduction).not.toHaveBeenCalled();
    });
});

describe('the reported decision', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    function outputOf(decision: ProductionTrainDecision): string {
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

    it('publishes exactly the decision the deploying and reporting steps read', () => {
        const served = requireCommitRevision(DEPLOYED);
        expect(outputOf({ deploy: true, reason: 'deploy', deployedRevision: served })).toBe(
            'deploy=true\nreason=deploy\n'
        );
        expect(outputOf({ deploy: false, reason: 'serving', deployedRevision: requireCommitRevision(CANDIDATE) })).toBe(
            'deploy=false\nreason=serving\n'
        );
        expect(outputOf({ deploy: false, reason: 'stale', deployedRevision: served })).toBe(
            'deploy=false\nreason=stale\n'
        );
    });

    it('writes nothing an API answer could have chosen', () => {
        const served = requireCommitRevision(DEPLOYED);
        const output = outputOf({ deploy: false, reason: 'stale', deployedRevision: served });
        expect(output).not.toContain(DEPLOYED);
        expect(output).not.toContain(CANDIDATE);
    });

    it('logs a stale refusal naming the candidate as what fails to descend, not the served revision', () => {
        const served = requireCommitRevision(DEPLOYED);
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        try {
            outputOf({ deploy: false, reason: 'stale', deployedRevision: served });
            expect(log).toHaveBeenCalledWith(
                `production serves ${DEPLOYED}, which the candidate ${CANDIDATE} does not descend from; the train deploys nothing`
            );
        } finally {
            log.mockRestore();
        }
    });
});
