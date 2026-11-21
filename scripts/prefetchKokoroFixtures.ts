import { createHash } from 'node:crypto';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { KOKORO_ARTIFACTS } from '../tests/e2e/kokoroFixtureArtifacts.ts';

/**
 * Downloads the pinned Kokoro artifacts the real-model E2E spec verifies into a directory, so CI
 * restores them from cache and the spec reads them through SOURDAW_KOKORO_FIXTURE_DIR instead of
 * fetching inside its test timeout. A file already present with the pinned size and sha256 is kept.
 *
 *   SOURDAW_KOKORO_FIXTURE_DIR=<dir> node scripts/prefetchKokoroFixtures.ts
 */

// Every attempt and backoff for both artifacts (2 × (4 × 90 s + 30 s) = 13 min) must fit inside
// the 15-minute timeout of the workflows' Prefetch Kokoro fixtures step, or the retries never run.
const ATTEMPTS = 4;
const ATTEMPT_TIMEOUT_MS = 90_000;
const RETRY_DELAY_MS = 5_000;

type PinnedArtifact = { name: string; url: string; size: number; sha256: string };

export type PrefetchDependencies = {
    fetch: (url: string, init: { signal: AbortSignal; credentials: 'omit' }) => Promise<Response>;
    /** The file's bytes, or null when it does not exist. */
    read: (path: string) => Promise<Uint8Array | null>;
    write: (path: string, bytes: Uint8Array) => void;
    sleep: (milliseconds: number) => Promise<void>;
    log: (line: string) => void;
};

function matchesPin(bytes: Uint8Array, artifact: PinnedArtifact): boolean {
    return bytes.byteLength === artifact.size && createHash('sha256').update(bytes).digest('hex') === artifact.sha256;
}

async function download(artifact: PinnedArtifact, dependencies: PrefetchDependencies): Promise<Uint8Array> {
    const response = await dependencies.fetch(artifact.url, {
        signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
        credentials: 'omit',
    });
    if (!response.ok) {
        throw new Error(`HTTP ${String(response.status)}: ${artifact.url}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!matchesPin(bytes, artifact)) {
        throw new Error(`${artifact.name} does not match its pinned size ${String(artifact.size)} and sha256`);
    }
    return bytes;
}

async function downloadWithRetries(artifact: PinnedArtifact, dependencies: PrefetchDependencies): Promise<Uint8Array> {
    let failure: unknown;
    for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
        try {
            return await download(artifact, dependencies);
        } catch (error) {
            failure = error;
            const reason = error instanceof Error ? error.message : String(error);
            dependencies.log(`${artifact.name} attempt ${String(attempt)}/${String(ATTEMPTS)} failed: ${reason}`);
            if (attempt < ATTEMPTS) {
                await dependencies.sleep(RETRY_DELAY_MS * attempt);
            }
        }
    }
    throw new Error(`Could not fetch ${artifact.name} after ${String(ATTEMPTS)} attempts`, { cause: failure });
}

export async function prefetchKokoroFixtures(
    directory: string,
    artifacts: readonly PinnedArtifact[],
    dependencies: PrefetchDependencies
): Promise<void> {
    for (const artifact of artifacts) {
        const target = join(directory, artifact.name);
        const existing = await dependencies.read(target);
        if (existing !== null && matchesPin(existing, artifact)) {
            dependencies.log(`${artifact.name} already present and verified`);
            continue;
        }
        dependencies.write(target, await downloadWithRetries(artifact, dependencies));
        dependencies.log(`${artifact.name} downloaded and verified`);
    }
}

async function readIfPresent(path: string): Promise<Uint8Array | null> {
    try {
        return await readFile(path);
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}

function writeAtomically(path: string, bytes: Uint8Array): void {
    const staging = `${path}.partial`;
    writeFileSync(staging, bytes);
    renameSync(staging, path);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const directory = process.env.SOURDAW_KOKORO_FIXTURE_DIR;
    if (directory === undefined || directory === '') {
        throw new Error('SOURDAW_KOKORO_FIXTURE_DIR must name the directory to fill');
    }
    mkdirSync(directory, { recursive: true });
    await prefetchKokoroFixtures(directory, KOKORO_ARTIFACTS, {
        fetch: (url, init) => fetch(url, init),
        read: readIfPresent,
        write: writeAtomically,
        sleep: (milliseconds) => delay(milliseconds),
        log: (line) => console.log(line),
    });
}
