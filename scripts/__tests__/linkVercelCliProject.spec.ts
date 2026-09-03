import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    buildProjectSettingsUrl,
    linkVercelCliProject,
    readProjectLink,
    requireEnvironment,
    writeProjectLinkFile,
} from '../linkVercelCliProject';

const TOKEN = 'token-fixture';

function okResponse(payload: unknown): { ok: boolean; status: number; json: () => Promise<unknown> } {
    return { ok: true, status: 200, json: () => Promise.resolve(payload) };
}

function projectPayload(orgId: string, projectId: string): unknown {
    return { accountId: orgId, id: projectId };
}

describe('the project settings query URL', () => {
    it('scopes a personal account without teamId', () => {
        const url = new URL(buildProjectSettingsUrl({ projectId: 'prj_fixture', orgId: 'user_fixture' }));
        expect(url.pathname.endsWith('/v9/projects/prj_fixture')).toBe(true);
        expect(url.searchParams.has('teamId')).toBe(false);
    });

    it('scopes a team account through teamId', () => {
        const url = new URL(buildProjectSettingsUrl({ projectId: 'prj_fixture', orgId: 'team_fixture' }));
        expect(url.searchParams.get('teamId')).toBe('team_fixture');
    });
});

describe('credential trimming', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('strips trailing newlines from secrets before building the URL', () => {
        vi.stubEnv('VERCEL_PROJECT_ID', 'prj_fixture\n');
        vi.stubEnv('VERCEL_ORG_ID', 'team_fixture\r\n');
        const url = new URL(
            buildProjectSettingsUrl({
                projectId: requireEnvironment('VERCEL_PROJECT_ID'),
                orgId: requireEnvironment('VERCEL_ORG_ID'),
            })
        );
        expect(url.pathname.endsWith('/v9/projects/prj_fixture')).toBe(true);
        expect(url.searchParams.get('teamId')).toBe('team_fixture');
    });
});

describe('the project link', () => {
    it('reads orgId from accountId and projectId from id', () => {
        expect(readProjectLink(projectPayload('team_live', 'prj_live'))).toEqual({
            orgId: 'team_live',
            projectId: 'prj_live',
        });
    });

    it('refuses an answer without an account id', () => {
        expect(() => readProjectLink({ id: 'prj_live' })).toThrow(
            'the project settings answer does not carry an account id'
        );
    });

    it('refuses an answer without a project id', () => {
        expect(() => readProjectLink({ accountId: 'team_live' })).toThrow(
            'the project settings answer does not carry a project id'
        );
    });
});

describe('linkVercelCliProject', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    function stubCredentials(orgId = 'user_wrong', projectId = 'prj_env'): void {
        vi.stubEnv('VERCEL_TOKEN', TOKEN);
        vi.stubEnv('VERCEL_ORG_ID', orgId);
        vi.stubEnv('VERCEL_PROJECT_ID', projectId);
    }

    it('writes accountId from the API answer, not env VERCEL_ORG_ID', async () => {
        stubCredentials();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse(projectPayload('team_live', 'prj_live'))));

        const rootDirectory = mkdtempSync(join(tmpdir(), 'sourdaw-vercel-link-'));
        try {
            await linkVercelCliProject(rootDirectory);
            const link = JSON.parse(readFileSync(join(rootDirectory, '.vercel', 'project.json'), 'utf8'));
            expect(link).toEqual({ orgId: 'team_live', projectId: 'prj_live' });
            expect(link).not.toEqual({ orgId: 'user_wrong', projectId: 'prj_env' });
        } finally {
            rmSync(rootDirectory, { recursive: true, force: true });
        }
    });

    it('refuses to link when the project settings query answers 404', async () => {
        stubCredentials('team_fixture', 'prj_fixture');
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));

        const rootDirectory = mkdtempSync(join(tmpdir(), 'sourdaw-vercel-link-'));
        try {
            await expect(linkVercelCliProject(rootDirectory)).rejects.toSatisfy((error: unknown) => {
                const message = String(error);
                return message.includes('404') && !message.includes(TOKEN) && !message.includes('prj_fixture');
            });
        } finally {
            rmSync(rootDirectory, { recursive: true, force: true });
        }
    });

    it('does not write a link file when accountId is missing', async () => {
        stubCredentials('team_fixture', 'prj_fixture');
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse({ id: 'prj_live' })));

        const rootDirectory = mkdtempSync(join(tmpdir(), 'sourdaw-vercel-link-'));
        try {
            await expect(linkVercelCliProject(rootDirectory)).rejects.toThrow(
                'the project settings answer does not carry an account id'
            );
            expect(existsSync(join(rootDirectory, '.vercel', 'project.json'))).toBe(false);
        } finally {
            rmSync(rootDirectory, { recursive: true, force: true });
        }
    });

    it('logs success without ids or the token', async () => {
        stubCredentials('team_fixture', 'prj_fixture');
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse(projectPayload('team_fixture', 'prj_fixture'))));
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});

        const rootDirectory = mkdtempSync(join(tmpdir(), 'sourdaw-vercel-link-'));
        try {
            await linkVercelCliProject(rootDirectory);
            expect(log).toHaveBeenCalledWith('linked the Vercel CLI to the production project');
            for (const call of log.mock.calls.flat()) {
                expect(String(call)).not.toMatch(/prj_|team_|user_|token-fixture/);
            }
        } finally {
            rmSync(rootDirectory, { recursive: true, force: true });
        }
    });

    it('does not write GITHUB_OUTPUT on a successful link', async () => {
        stubCredentials('team_fixture', 'prj_fixture');
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse(projectPayload('team_fixture', 'prj_fixture'))));

        const rootDirectory = mkdtempSync(join(tmpdir(), 'sourdaw-vercel-link-'));
        const outputPath = join(rootDirectory, 'github-output');
        try {
            vi.stubEnv('GITHUB_OUTPUT', outputPath);
            await linkVercelCliProject(rootDirectory);
            expect(existsSync(outputPath)).toBe(false);
        } finally {
            rmSync(rootDirectory, { recursive: true, force: true });
        }
    });
});

describe('writeProjectLinkFile', () => {
    it('writes orgId and projectId with a trailing newline', () => {
        const rootDirectory = mkdtempSync(join(tmpdir(), 'sourdaw-vercel-link-file-'));
        try {
            const filePath = writeProjectLinkFile(rootDirectory, { orgId: 'team_live', projectId: 'prj_live' });
            expect(readFileSync(filePath, 'utf8')).toBe('{"orgId":"team_live","projectId":"prj_live"}\n');
        } finally {
            rmSync(rootDirectory, { recursive: true, force: true });
        }
    });
});
