import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseCoverageMap } from './e2eCoverageSelection.ts';

/**
 * Retrieves the newest coverage map the scheduled or dispatched nightly published from `main`
 * on this repository, for the pull-request planner. Artifacts from pull-request runs, forks,
 * other workflows, or other branches are never used. Any failure writes nothing and exits 0:
 * the planner then keeps the full browser suite.
 *
 *   GH_TOKEN=… GITHUB_REPOSITORY=owner/repo E2E_COVERAGE_MAP=<file> node scripts/fetchE2eCoverageMap.ts
 */

const ARTIFACT_NAME = 'e2e-coverage-map';
const MAP_FILE = 'e2e-coverage-map.json';
const NIGHTLY_WORKFLOW = '.github/workflows/nightly.yml';
const NIGHTLY_EVENTS = new Set(['schedule', 'workflow_dispatch']);
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const API_VERSION = '2022-11-28';
const SHA = /^[0-9a-f]{40}$/;
// The output file is line oriented, so only a plain ISO timestamp may reach it.
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

type Artifact = {
    id: number;
    name: string;
    expired: boolean;
    createdAt: string;
    sizeInBytes: number;
    downloadUrl: string;
    runId: number;
    headBranch: string;
    headSha: string;
};

export type FetchDependencies = {
    fetch: (url: string, init: { headers: Record<string, string> }) => Promise<Response>;
    /** The named member of a zip archive, as text. */
    extract: (archive: Uint8Array, member: string) => string;
    writeMap: (path: string, text: string) => void;
    appendOutput: (line: string) => void;
    log: (line: string) => void;
};

export type FetchEnvironment = {
    token: string | undefined;
    repository: string | undefined;
    apiUrl: string;
    mapPath: string | undefined;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readArtifact(value: unknown): Artifact | null {
    if (!isRecord(value) || !isRecord(value.workflow_run)) {
        return null;
    }
    const run = value.workflow_run;
    if (
        typeof value.id !== 'number' ||
        typeof value.name !== 'string' ||
        typeof value.expired !== 'boolean' ||
        typeof value.created_at !== 'string' ||
        typeof value.size_in_bytes !== 'number' ||
        typeof value.archive_download_url !== 'string' ||
        typeof run.id !== 'number' ||
        typeof run.head_branch !== 'string' ||
        typeof run.head_sha !== 'string'
    ) {
        return null;
    }
    return {
        id: value.id,
        name: value.name,
        expired: value.expired,
        createdAt: value.created_at,
        sizeInBytes: value.size_in_bytes,
        downloadUrl: value.archive_download_url,
        runId: run.id,
        headBranch: run.head_branch,
        headSha: run.head_sha,
    };
}

/** Nightly runs of this repository's `main`, newest first, before their runs are verified. */
export function candidateArtifacts(listing: unknown): Artifact[] {
    if (!isRecord(listing) || !Array.isArray(listing.artifacts)) {
        throw new Error('artifact listing is malformed');
    }
    const artifacts = listing.artifacts.map(readArtifact);
    return artifacts
        .filter(
            (artifact): artifact is Artifact =>
                artifact !== null &&
                artifact.name === ARTIFACT_NAME &&
                !artifact.expired &&
                artifact.headBranch === 'main' &&
                TIMESTAMP.test(artifact.createdAt)
        )
        .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

/** Whether the run that uploaded an artifact is this repository's own scheduled or dispatched nightly on `main`. */
export function isTrustedNightlyRun(run: unknown, repository: string, artifact: Artifact): boolean {
    if (!isRecord(run) || !isRecord(run.repository) || !isRecord(run.head_repository)) {
        return false;
    }
    return (
        run.id === artifact.runId &&
        run.path === NIGHTLY_WORKFLOW &&
        typeof run.event === 'string' &&
        NIGHTLY_EVENTS.has(run.event) &&
        run.head_branch === 'main' &&
        run.head_sha === artifact.headSha &&
        run.repository.full_name === repository &&
        run.head_repository.full_name === repository
    );
}

async function getJson(dependencies: FetchDependencies, url: string, token: string): Promise<unknown> {
    const response = await dependencies.fetch(url, {
        headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${token}`,
            'X-GitHub-Api-Version': API_VERSION,
        },
    });
    if (!response.ok) {
        throw new Error(`GET ${new URL(url).pathname} answered ${response.status}`);
    }
    return response.json();
}

async function download(dependencies: FetchDependencies, artifact: Artifact, token: string): Promise<Uint8Array> {
    const response = await dependencies.fetch(artifact.downloadUrl, {
        headers: { Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': API_VERSION },
    });
    if (!response.ok) {
        throw new Error(`artifact ${artifact.id} download answered ${response.status}`);
    }
    const archive = new Uint8Array(await response.arrayBuffer());
    if (archive.byteLength > MAX_ARCHIVE_BYTES) {
        throw new Error(`artifact ${artifact.id} exceeds ${MAX_ARCHIVE_BYTES} bytes`);
    }
    return archive;
}

async function retrieve(environment: FetchEnvironment, dependencies: FetchDependencies): Promise<string> {
    const { token, repository, mapPath } = environment;
    if (!token || !repository || !/^[\w.-]+\/[\w.-]+$/.test(repository) || !mapPath) {
        throw new Error('requires a token, GITHUB_REPOSITORY and E2E_COVERAGE_MAP');
    }
    const api = environment.apiUrl.replace(/\/+$/, '');
    const listing = await getJson(
        dependencies,
        `${api}/repos/${repository}/actions/artifacts?name=${ARTIFACT_NAME}&per_page=100`,
        token
    );
    for (const artifact of candidateArtifacts(listing)) {
        if (!SHA.test(artifact.headSha) || artifact.sizeInBytes > MAX_ARCHIVE_BYTES) {
            continue;
        }
        const run = await getJson(dependencies, `${api}/repos/${repository}/actions/runs/${artifact.runId}`, token);
        if (!isTrustedNightlyRun(run, repository, artifact)) {
            continue;
        }
        const text = dependencies.extract(await download(dependencies, artifact, token), MAP_FILE);
        const map = parseCoverageMap(text);
        if (map.commit !== artifact.headSha) {
            throw new Error(`artifact ${artifact.id} maps ${map.commit}, not its run's ${artifact.headSha}`);
        }
        dependencies.writeMap(mapPath, text);
        dependencies.appendOutput(`created-at=${artifact.createdAt}`);
        return `retrieved artifact ${artifact.id} for ${map.commit}, created ${artifact.createdAt}`;
    }
    throw new Error('no artifact from a scheduled or dispatched nightly on main');
}

/** Retrieve the map, or report one line and write nothing. Never fails the job. */
export async function fetchCoverageMap(environment: FetchEnvironment, dependencies: FetchDependencies): Promise<void> {
    try {
        dependencies.log(`e2e coverage map: ${await retrieve(environment, dependencies)}`);
    } catch (error) {
        dependencies.log(
            `e2e coverage map unavailable; the full browser suite stays selected: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

function extractWithUnzip(archive: Uint8Array, member: string): string {
    const directory = mkdtempSync(join(process.env.RUNNER_TEMP ?? tmpdir(), 'e2e-coverage-map-'));
    try {
        const zip = join(directory, 'artifact.zip');
        writeFileSync(zip, archive);
        // `-p` streams the one member to stdout, so no archive path ever reaches the filesystem.
        return execFileSync('unzip', ['-p', zip, member], { encoding: 'utf8', maxBuffer: 4 * MAX_ARCHIVE_BYTES });
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}

function writeAtomically(path: string, text: string): void {
    const staging = `${path}.partial`;
    writeFileSync(staging, text);
    renameSync(staging, path);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const output = process.env.GITHUB_OUTPUT;
    await fetchCoverageMap(
        {
            token: process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN,
            repository: process.env.GITHUB_REPOSITORY,
            apiUrl: process.env.GITHUB_API_URL ?? 'https://api.github.com',
            mapPath: process.env.E2E_COVERAGE_MAP,
        },
        {
            fetch: (url, init) => fetch(url, init),
            extract: extractWithUnzip,
            writeMap: writeAtomically,
            appendOutput: (line) => {
                if (output) {
                    appendFileSync(output, `${line}\n`);
                }
            },
            log: (line) => console.log(line),
        }
    );
}
