#!/usr/bin/env node
/**
 * Names the domains the daily web train is allowed to grade after it deploys.
 *
 * The train's isolation assertion used to read the generated deployment URL
 * the deploy step printed. Under the project's Standard Protection setting
 * every generated deployment URL is restricted behind Vercel Authentication,
 * and only the production domains are public — so that URL answers a redirect
 * to `https://vercel.com/sso-api`, and an assertion that follows it grades the
 * Vercel login page instead of the deployment.
 *
 * The deployment record answers the question directly. `GET /v13/deployments/
 * {idOrUrl}` carries the aliases assigned when the deployment was created,
 * which is what binds the check to *this* deployment rather than to whatever
 * the production domain happened to serve yesterday. `aliasAssigned` is what
 * says those aliases actually took; `aliasError` is what says they did not.
 * Neither is optional here: a train that graded a domain before the alias
 * moved would be reporting on the previous deployment, which is the failure
 * this script exists to prevent.
 *
 * Every hostname it returns reaches `GITHUB_OUTPUT`, whose line-oriented
 * format makes an embedded newline a way to define further workflow outputs,
 * and then reaches a URL in the asserting step's shell. Nothing that is not a
 * bare hostname leaves this file.
 */

import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DEPLOYMENTS_ENDPOINT = 'https://api.vercel.com/v13/deployments';
const TEAM_SCOPE_PREFIX = 'team_';
/**
 * A bare hostname and nothing else: dot-separated labels of lowercase letters,
 * digits and interior hyphens. No scheme, no port, no path, no whitespace, no
 * newline.
 */
const ALIAS_HOSTNAME = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/u;

function asRecord(value: unknown): Record<string, unknown> | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, unknown>;
}

function requireEnvironment(name: string): string {
    const value = process.env[name];
    if (value === undefined || value === '') {
        throw new Error(`${name} must be set to resolve the aliases of the deployment`);
    }
    return value;
}

function parseDeploymentUrl(deploymentUrl: string): URL | null {
    try {
        return new URL(deploymentUrl);
    } catch {
        return null;
    }
}

/**
 * The deployment record for the URL the deploy step printed. Vercel scopes a
 * query to a team through `teamId`; a personal account's organisation id is a
 * user id instead, which that parameter rejects, so only a team scope belongs
 * on the query string.
 */
export function buildDeploymentUrl(deploymentUrl: string, orgId: string): string {
    const deployment = parseDeploymentUrl(deploymentUrl);
    if (deployment === null || deployment.protocol !== 'https:' || deployment.hostname === '') {
        throw new Error(`${deploymentUrl} is not an https deployment URL`);
    }
    const url = new URL(`${DEPLOYMENTS_ENDPOINT}/${deployment.hostname}`);
    if (orgId.startsWith(TEAM_SCOPE_PREFIX)) {
        url.searchParams.set('teamId', orgId);
    }
    return url.toString();
}

function requireAliasHostname(alias: unknown): string {
    if (typeof alias !== 'string' || !ALIAS_HOSTNAME.test(alias)) {
        throw new Error(`the deployment record names an alias that is not a bare hostname: ${String(alias)}`);
    }
    return alias;
}

/**
 * The aliases the deployment actually took. An alias list that was not
 * assigned, or that Vercel reports an error for, is not evidence about any
 * domain: grading one then would read whatever the domain served before this
 * deployment existed.
 */
export function readAssignedAliases(payload: unknown): readonly string[] {
    const deployment = asRecord(payload);
    if (deployment === null) {
        throw new Error('the deployment query answered no deployment record');
    }
    const aliasError = asRecord(deployment.aliasError);
    if (aliasError !== null) {
        throw new Error(
            `the deployment could not take its aliases: ${String(aliasError.code)} ${String(aliasError.message)}`
        );
    }
    if (deployment.aliasAssigned !== true) {
        throw new Error('the deployment has not been assigned its aliases');
    }
    const aliases = deployment.alias;
    if (!Array.isArray(aliases) || aliases.length === 0) {
        throw new Error('the deployment record names no alias');
    }
    return aliases.map(requireAliasHostname);
}

async function readDeployment(url: string, token: string): Promise<unknown> {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) {
        throw new Error(`the deployment query answered ${String(response.status)}`);
    }
    return await response.json();
}

export async function resolveDeploymentAliases(): Promise<readonly string[]> {
    const url = buildDeploymentUrl(requireEnvironment('DEPLOYMENT_URL'), requireEnvironment('VERCEL_ORG_ID'));
    return readAssignedAliases(await readDeployment(url, requireEnvironment('VERCEL_TOKEN')));
}

export function reportAliases(aliases: readonly string[]): void {
    const line = aliases.join(' ');
    appendFileSync(requireEnvironment('GITHUB_OUTPUT'), `aliases=${line}\n`);
    console.log(`aliases: ${line}`);
}

async function main(): Promise<void> {
    reportAliases(await resolveDeploymentAliases());
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main().catch((error: unknown) => {
        console.error(`the daily web train could not resolve the aliases of the deployment: ${String(error)}`);
        process.exit(1);
    });
}
