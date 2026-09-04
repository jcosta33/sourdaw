/**
 * The daily web train grades the deployment it just created for cross-origin
 * isolation, and the only domains it may grade are the public production
 * aliases that deployment took. Every way this resolution can go wrong ends in
 * one of two outcomes: a train that grades a page belonging to somebody else —
 * a restricted deployment URL answers a redirect to the Vercel login page —
 * or a train that grades a domain still serving the previous deployment. These
 * cases pin the answer to an alias list the deployment record says was
 * actually assigned, and to hostnames that cannot carry anything else into
 * `GITHUB_OUTPUT` or into the asserting step's shell.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    buildDeploymentUrl,
    readAssignedAliases,
    reportAliases,
    resolveDeploymentAliases,
} from '../resolveVercelDeploymentAliases';

const DEPLOYMENT_URL = 'https://sourdaw-50iyeta1c-jos-costas-projects.vercel.app';
const DEPLOYMENT_HOST = 'sourdaw-50iyeta1c-jos-costas-projects.vercel.app';
const PRODUCTION_ALIAS = 'app.sourdaw.studio';
const SECOND_ALIAS = 'sourdaw.studio';
// What a compromised or merely wrong answer can carry. `GITHUB_OUTPUT` is
// line-oriented, so the newline is the whole attack: written unvalidated, the
// second line would define an output the asserting step reads.
const INJECTION_ALIAS = `${PRODUCTION_ALIAS}\naliases=vercel.com`;

function assignedPayload(aliases: readonly unknown[]): unknown {
    return { uid: 'dpl_fixture', readyState: 'READY', alias: aliases, aliasAssigned: true, aliasError: null };
}

function okResponse(payload: unknown): { ok: boolean; status: number; json: () => Promise<unknown> } {
    return { ok: true, status: 200, json: () => Promise.resolve(payload) };
}

describe('the deployment record query', () => {
    it('asks for the deployment the deploy step printed, by its own hostname', () => {
        const url = new URL(buildDeploymentUrl(DEPLOYMENT_URL, 'user_fixture'));
        expect(url.origin + url.pathname).toBe(`https://api.vercel.com/v13/deployments/${DEPLOYMENT_HOST}`);
    });

    it('scopes the query to a team, and only to a team', () => {
        const team = new URL(buildDeploymentUrl(DEPLOYMENT_URL, 'team_fixture'));
        expect(team.searchParams.get('teamId')).toBe('team_fixture');
        // A personal account's organisation id is a user id; `teamId` rejects
        // it, and a rejected query fails the train rather than grading nothing.
        const personal = new URL(buildDeploymentUrl(DEPLOYMENT_URL, 'user_fixture'));
        expect(personal.searchParams.has('teamId')).toBe(false);
    });

    it('refuses a deployment URL that is not an absolute https URL', () => {
        for (const value of [DEPLOYMENT_HOST, `http://${DEPLOYMENT_HOST}`, '/deployments/dpl_fixture', '']) {
            expect(() => buildDeploymentUrl(value, 'team_fixture')).toThrow(`${value} is not an https deployment URL`);
        }
    });
});

describe('the assigned aliases', () => {
    it('are the hostnames the deployment took, in the order the record names them', () => {
        expect(readAssignedAliases(assignedPayload([PRODUCTION_ALIAS, SECOND_ALIAS]))).toEqual([
            PRODUCTION_ALIAS,
            SECOND_ALIAS,
        ]);
    });

    it('are unusable while the deployment has not been assigned them', () => {
        expect(() =>
            readAssignedAliases({ alias: [PRODUCTION_ALIAS], aliasAssigned: false, aliasError: null })
        ).toThrow('the deployment has not been assigned its aliases');
        expect(() => readAssignedAliases({ alias: [PRODUCTION_ALIAS] })).toThrow(
            'the deployment has not been assigned its aliases'
        );
    });

    it('are unusable when the record reports why the aliases failed', () => {
        expect(() =>
            readAssignedAliases({
                alias: [PRODUCTION_ALIAS],
                aliasAssigned: false,
                aliasError: { code: 'forbidden', message: 'not authorized to access the domain' },
            })
        ).toThrow('forbidden');
    });

    it('are unusable when the record names no alias at all', () => {
        expect(() => readAssignedAliases(assignedPayload([]))).toThrow('the deployment record names no alias');
        expect(() => readAssignedAliases({ aliasAssigned: true, aliasError: null })).toThrow(
            'the deployment record names no alias'
        );
    });

    it('are unusable when the answer is not a deployment record', () => {
        expect(() => readAssignedAliases(null)).toThrow('the deployment query answered no deployment record');
        expect(() => readAssignedAliases([assignedPayload([PRODUCTION_ALIAS])])).toThrow(
            'the deployment query answered no deployment record'
        );
    });

    it('are unusable when an entry is anything but a bare hostname', () => {
        for (const alias of [
            INJECTION_ALIAS,
            `https://${PRODUCTION_ALIAS}`,
            `${PRODUCTION_ALIAS}/`,
            `${PRODUCTION_ALIAS}/sso-api`,
            `${PRODUCTION_ALIAS} vercel.com`,
            `-${PRODUCTION_ALIAS}`,
            `${PRODUCTION_ALIAS}.`,
            PRODUCTION_ALIAS.toUpperCase(),
            'localhost',
            42,
            null,
        ]) {
            expect(() => readAssignedAliases(assignedPayload([PRODUCTION_ALIAS, alias]))).toThrow(
                'is not a bare hostname'
            );
        }
    });
});

describe('the resolved aliases', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
    });

    function stubCredentials(): void {
        vi.stubEnv('VERCEL_ORG_ID', 'team_fixture');
        vi.stubEnv('VERCEL_TOKEN', 'token-fixture');
        vi.stubEnv('DEPLOYMENT_URL', DEPLOYMENT_URL);
    }

    it('authenticates the deployment query it built and answers the assigned aliases', async () => {
        stubCredentials();
        const fetchDeployment = vi
            .fn()
            .mockResolvedValue(okResponse(assignedPayload([PRODUCTION_ALIAS, SECOND_ALIAS])));
        vi.stubGlobal('fetch', fetchDeployment);

        await expect(resolveDeploymentAliases()).resolves.toEqual([PRODUCTION_ALIAS, SECOND_ALIAS]);
        expect(fetchDeployment).toHaveBeenCalledWith(buildDeploymentUrl(DEPLOYMENT_URL, 'team_fixture'), {
            headers: { Authorization: 'Bearer token-fixture' },
        });
    });

    it('refuses to answer when the deployment query is unanswered or unauthorised', async () => {
        stubCredentials();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));
        await expect(resolveDeploymentAliases()).rejects.toThrow('the deployment query answered 403');
    });

    it('refuses to answer without the deployment URL and credentials the query needs', async () => {
        const fetchDeployment = vi.fn();
        vi.stubGlobal('fetch', fetchDeployment);
        for (const missing of ['DEPLOYMENT_URL', 'VERCEL_ORG_ID', 'VERCEL_TOKEN']) {
            stubCredentials();
            vi.stubEnv(missing, '');
            await expect(resolveDeploymentAliases()).rejects.toThrow(
                `${missing} must be set to resolve the aliases of the deployment`
            );
        }
        expect(fetchDeployment).not.toHaveBeenCalled();
    });
});

describe('the reported aliases', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    function outputOf(aliases: readonly string[]): string {
        const directory = mkdtempSync(join(tmpdir(), 'sourdaw-vercel-aliases-'));
        const outputPath = join(directory, 'github-output');
        try {
            vi.stubEnv('GITHUB_OUTPUT', outputPath);
            reportAliases(aliases);
            return readFileSync(outputPath, 'utf8');
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    }

    it('publishes exactly the space-separated list the asserting step iterates', () => {
        expect(outputOf([PRODUCTION_ALIAS, SECOND_ALIAS])).toBe(`aliases=${PRODUCTION_ALIAS} ${SECOND_ALIAS}\n`);
        expect(outputOf([PRODUCTION_ALIAS])).toBe(`aliases=${PRODUCTION_ALIAS}\n`);
    });

    it('logs the same list it published', () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        try {
            outputOf([PRODUCTION_ALIAS, SECOND_ALIAS]);
            expect(log).toHaveBeenCalledWith(`aliases: ${PRODUCTION_ALIAS} ${SECOND_ALIAS}`);
        } finally {
            log.mockRestore();
        }
    });
});
