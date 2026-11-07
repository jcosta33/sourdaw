import { execFileSync } from 'node:child_process';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build, type InlineConfig } from 'vite';

const manifestName = 'shared-e2e-manifest.json';

type Build = (config: InlineConfig) => Promise<unknown>;

function assertSha(sha: string): void {
    if (!/^[a-f0-9]{40}$/.test(sha)) {
        throw new Error('Expected a full Git integration SHA');
    }
}

async function requireFile(path: string): Promise<void> {
    const stat = await lstat(path);
    if (!stat.isFile()) {
        throw new Error(`Expected a regular file: ${path}`);
    }
}

export async function buildSharedE2e(root: string, sha: string, buildApp: Build = build): Promise<void> {
    assertSha(sha);
    await buildApp({ root, mode: 'e2e', build: { copyPublicDir: false } });
    const dist = join(root, 'dist');
    await requireFile(join(dist, 'index.html'));
    await writeFile(join(dist, manifestName), JSON.stringify({ sha, mode: 'e2e' }));
}

async function copyMissing(source: string, destination: string): Promise<void> {
    for (const entry of await readdir(source, { withFileTypes: true })) {
        const from = join(source, entry.name);
        const to = join(destination, entry.name);
        if (entry.isSymbolicLink()) {
            throw new Error(`Public asset is a symlink: ${from}`);
        }
        let existing;
        try {
            existing = await lstat(to);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                throw error;
            }
        }
        if (existing?.isSymbolicLink()) {
            throw new Error(`Build output is a symlink: ${to}`);
        }
        if (entry.isDirectory()) {
            if (existing && !existing.isDirectory()) {
                continue;
            }
            if (!existing) {
                await mkdir(to);
            }
            await copyMissing(from, to);
        } else if (entry.isFile() && !existing) {
            await copyFile(from, to, constants.COPYFILE_EXCL);
        }
    }
}

export async function prepareSharedE2e(root: string, sha: string): Promise<void> {
    assertSha(sha);
    const dist = join(root, 'dist');
    const distStat = await lstat(dist);
    if (!distStat.isDirectory()) {
        throw new Error('Expected a build output directory');
    }
    const manifestPath = join(dist, manifestName);
    await requireFile(manifestPath);
    await requireFile(join(dist, 'index.html'));
    const manifest: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (
        typeof manifest !== 'object' ||
        manifest === null ||
        Array.isArray(manifest) ||
        Object.keys(manifest).length !== 2 ||
        !('sha' in manifest) ||
        manifest.sha !== sha ||
        !('mode' in manifest) ||
        manifest.mode !== 'e2e'
    ) {
        throw new Error('Shared E2E build manifest does not match this checkout and mode');
    }
    await copyMissing(join(root, 'public'), dist);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const root = resolve(import.meta.dirname, '..');
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    if (!process.env.GITHUB_SHA || process.env.GITHUB_SHA !== sha) {
        throw new Error('GITHUB_SHA must match the checked-out integration commit');
    }
    if (process.argv[2] === 'build') {
        await buildSharedE2e(root, sha);
    } else if (process.argv[2] === 'prepare') {
        await prepareSharedE2e(root, sha);
    } else {
        throw new Error('Expected build or prepare');
    }
}
