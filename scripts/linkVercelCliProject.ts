#!/usr/bin/env node
/**
 * Links the Vercel CLI to the production project before `vercel pull`.
 *
 * When both `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` are set, the CLI treats
 * them as the link and looks up the org — a lookup the deployments API never
 * performs. A present-but-wrong org id can let resolve succeed and then make
 * `vercel pull` fail with "Project not found". This script reads the project
 * settings from the API and writes `.vercel/project.json` from the answer.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

type ProjectLinkScope = {
    readonly projectId: string;
    readonly orgId: string;
};

export type ProjectLink = {
    readonly orgId: string;
    readonly projectId: string;
};

const PROJECT_ENDPOINT = 'https://api.vercel.com/v9/projects';
const TEAM_SCOPE_PREFIX = 'team_';

function asRecord(value: unknown): Record<string, unknown> | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, unknown>;
}

export function trimCredential(value: string): string {
    return value.replaceAll(/^[\t \f\v\r\n]+|[\t \f\v\r\n]+$/g, '');
}

export function requireEnvironment(name: string): string {
    const raw = process.env[name];
    if (raw === undefined) {
        throw new Error(`${name} must be set to link the Vercel CLI to the production project`);
    }
    const value = trimCredential(raw);
    if (value === '') {
        throw new Error(`${name} must be set to link the Vercel CLI to the production project`);
    }
    return value;
}

/**
 * Vercel scopes a query to a team through `teamId`. A personal account's
 * organisation id is a user id instead, which that parameter rejects, so only a
 * team scope belongs on the query string.
 */
export function buildProjectSettingsUrl(scope: ProjectLinkScope): string {
    const url = new URL(`${PROJECT_ENDPOINT}/${encodeURIComponent(scope.projectId)}`);
    if (scope.orgId.startsWith(TEAM_SCOPE_PREFIX)) {
        url.searchParams.set('teamId', scope.orgId);
    }
    return url.toString();
}

export function readProjectLink(payload: unknown): ProjectLink {
    const record = asRecord(payload);
    const orgId = typeof record?.accountId === 'string' ? trimCredential(record.accountId) : '';
    const projectId = typeof record?.id === 'string' ? trimCredential(record.id) : '';
    if (orgId === '') {
        throw new Error('the project settings answer does not carry an account id');
    }
    if (projectId === '') {
        throw new Error('the project settings answer does not carry a project id');
    }
    return { orgId, projectId };
}

export function writeProjectLinkFile(rootDirectory: string, link: ProjectLink): string {
    const directory = join(rootDirectory, '.vercel');
    mkdirSync(directory, { recursive: true });
    const filePath = join(directory, 'project.json');
    writeFileSync(filePath, `${JSON.stringify({ orgId: link.orgId, projectId: link.projectId })}\n`, 'utf8');
    return filePath;
}

async function readProjectSettings(url: string, token: string): Promise<unknown> {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) {
        throw new Error(`the Vercel project settings query answered ${String(response.status)}`);
    }
    return await response.json();
}

export async function linkVercelCliProject(rootDirectory: string): Promise<string> {
    const token = requireEnvironment('VERCEL_TOKEN');
    const orgId = requireEnvironment('VERCEL_ORG_ID');
    const projectId = requireEnvironment('VERCEL_PROJECT_ID');
    const url = buildProjectSettingsUrl({ projectId, orgId });
    const payload = await readProjectSettings(url, token);
    const link = readProjectLink(payload);
    const filePath = writeProjectLinkFile(rootDirectory, link);
    console.log('linked the Vercel CLI to the production project');
    return filePath;
}

async function main(): Promise<void> {
    await linkVercelCliProject(process.cwd());
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main().catch((error: unknown) => {
        console.error(`could not link the Vercel CLI to the production project: ${String(error)}`);
        process.exit(1);
    });
}
