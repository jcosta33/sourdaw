import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { writeVercelPrebuiltOutput } from '../writeVercelPrebuiltOutput';

type HeaderEntry = {
    readonly key: string;
    readonly value: string;
};

const EXISTING_PROJECT_LINK = '{"orgId":"team_fixture","projectId":"prj_fixture"}\n';

function makeRoot(): string {
    return mkdtempSync(join(tmpdir(), 'sourdaw-vercel-prebuilt-'));
}

function writeDist(rootDirectory: string): void {
    mkdirSync(join(rootDirectory, 'dist', 'nested'), { recursive: true });
    writeFileSync(join(rootDirectory, 'dist', 'index.html'), '<!doctype html>\n');
    writeFileSync(join(rootDirectory, 'dist', 'nested', 'asset.txt'), 'nested-asset\n');
}

function writeVercelJson(rootDirectory: string, headers: readonly HeaderEntry[]): void {
    writeFileSync(
        join(rootDirectory, 'vercel.json'),
        `${JSON.stringify({
            headers: [
                {
                    source: '/(.*)',
                    headers,
                },
            ],
        })}\n`,
        'utf8'
    );
}

function writeExistingProjectLink(rootDirectory: string): string {
    mkdirSync(join(rootDirectory, '.vercel'), { recursive: true });
    const path = join(rootDirectory, '.vercel', 'project.json');
    writeFileSync(path, EXISTING_PROJECT_LINK, 'utf8');
    return path;
}

function readOutputConfig(rootDirectory: string): {
    readonly version: unknown;
    readonly routes: readonly unknown[];
} {
    const parsed: unknown = JSON.parse(readFileSync(join(rootDirectory, '.vercel', 'output', 'config.json'), 'utf8'));
    expect(parsed).toEqual(expect.objectContaining({ version: expect.anything(), routes: expect.any(Array) }));
    const record = parsed as { readonly version: unknown; readonly routes: readonly unknown[] };
    return record;
}

describe('writeVercelPrebuiltOutput', () => {
    const roots: string[] = [];

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
        for (const root of roots.splice(0)) {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('copies nested dist files into the prebuilt static tree and compiles vercel.json headers', () => {
        const rootDirectory = makeRoot();
        roots.push(rootDirectory);
        writeDist(rootDirectory);
        const probeName = `X-Prebuilt-Probe-${String(Date.now())}`;
        const probeValue = `probe-${String(Date.now())}`;
        writeVercelJson(rootDirectory, [
            { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
            { key: probeName, value: probeValue },
        ]);
        const linkPath = writeExistingProjectLink(rootDirectory);
        mkdirSync(join(rootDirectory, '.vercel', 'output', 'static'), { recursive: true });
        writeFileSync(join(rootDirectory, '.vercel', 'output', 'static', 'stale.txt'), 'stale\n');

        writeVercelPrebuiltOutput(rootDirectory);

        expect(readFileSync(join(rootDirectory, '.vercel', 'output', 'static', 'index.html'), 'utf8')).toBe(
            '<!doctype html>\n'
        );
        expect(readFileSync(join(rootDirectory, '.vercel', 'output', 'static', 'nested', 'asset.txt'), 'utf8')).toBe(
            'nested-asset\n'
        );
        expect(existsSync(join(rootDirectory, '.vercel', 'output', 'static', 'stale.txt'))).toBe(false);
        expect(readFileSync(linkPath, 'utf8')).toBe(EXISTING_PROJECT_LINK);

        const config = readOutputConfig(rootDirectory);
        expect(config.version).toBe(3);
        expect(config.routes).toEqual([
            {
                src: '/(.*)',
                headers: {
                    'Cross-Origin-Opener-Policy': 'same-origin',
                    [probeName]: probeValue,
                },
                continue: true,
            },
            { handle: 'filesystem' },
            { src: '/(.*)', dest: '/index.html' },
        ]);
    });

    it('leaves a pre-existing project.json untouched when the output directory already exists', () => {
        const rootDirectory = makeRoot();
        roots.push(rootDirectory);
        writeDist(rootDirectory);
        writeVercelJson(rootDirectory, [{ key: 'X-Isolation', value: 'required' }]);
        const linkPath = writeExistingProjectLink(rootDirectory);

        writeVercelPrebuiltOutput(rootDirectory);

        expect(readFileSync(linkPath, 'utf8')).toBe(EXISTING_PROJECT_LINK);
    });

    it('logs a fixed success sentence without writing GITHUB_OUTPUT', () => {
        const rootDirectory = makeRoot();
        roots.push(rootDirectory);
        writeDist(rootDirectory);
        writeVercelJson(rootDirectory, [{ key: 'X-Isolation', value: 'required' }]);
        const outputPath = join(rootDirectory, 'github-output');
        vi.stubEnv('GITHUB_OUTPUT', outputPath);
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});

        writeVercelPrebuiltOutput(rootDirectory);

        expect(log).toHaveBeenCalledWith('wrote the prebuilt Vercel output from the local dist');
        expect(existsSync(outputPath)).toBe(false);
    });

    it('throws when dist is missing', () => {
        const rootDirectory = makeRoot();
        roots.push(rootDirectory);
        writeVercelJson(rootDirectory, [{ key: 'X-Isolation', value: 'required' }]);

        expect(() => writeVercelPrebuiltOutput(rootDirectory)).toThrow('the Vite dist directory is missing');
        expect(existsSync(join(rootDirectory, '.vercel', 'output'))).toBe(false);
    });

    it('throws when vercel.json has no headers', () => {
        const rootDirectory = makeRoot();
        roots.push(rootDirectory);
        writeDist(rootDirectory);
        writeFileSync(join(rootDirectory, 'vercel.json'), `${JSON.stringify({ git: { deploymentEnabled: false } })}\n`);

        expect(() => writeVercelPrebuiltOutput(rootDirectory)).toThrow(
            'vercel.json has no isolation headers to compile'
        );
        expect(existsSync(join(rootDirectory, '.vercel', 'output'))).toBe(false);
    });
});
