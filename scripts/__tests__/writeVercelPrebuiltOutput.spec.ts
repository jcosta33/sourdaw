import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { writeVercelPrebuiltOutput } from '../writeVercelPrebuiltOutput';

type HeaderEntry = {
    readonly key: string;
    readonly value: string;
};

const REPOSITORY_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const PRODUCTION_VERCEL_HEADERS = readProductionVercelHeaders();

function readProductionVercelHeaders(): readonly HeaderEntry[] {
    const payload: unknown = JSON.parse(readFileSync(join(REPOSITORY_ROOT, 'vercel.json'), 'utf8'));
    if (typeof payload !== 'object' || payload === null || !('headers' in payload)) {
        throw new TypeError('vercel.json is missing production headers');
    }
    const headers = (payload as { readonly headers: unknown }).headers;
    if (!Array.isArray(headers) || headers.length === 0) {
        throw new TypeError('vercel.json is missing production headers');
    }
    const firstRule = headers[0];
    if (typeof firstRule !== 'object' || firstRule === null || !('headers' in firstRule)) {
        throw new TypeError('vercel.json is missing production headers');
    }
    const ruleHeaders = (firstRule as { readonly headers: unknown }).headers;
    if (!Array.isArray(ruleHeaders)) {
        throw new TypeError('vercel.json is missing production headers');
    }
    return ruleHeaders.map((entry) => {
        if (typeof entry !== 'object' || entry === null) {
            throw new TypeError('vercel.json is missing production headers');
        }
        const key = 'key' in entry && typeof entry.key === 'string' ? entry.key : '';
        const value = 'value' in entry && typeof entry.value === 'string' ? entry.value : '';
        if (key === '' || value === '') {
            throw new TypeError('vercel.json is missing production headers');
        }
        return { key, value };
    });
}

const EXISTING_PROJECT_LINK = '{"orgId":"team_fixture","projectId":"prj_fixture"}\n';

function makeRoot(): string {
    return mkdtempSync(join(tmpdir(), 'sourdaw-vercel-prebuilt-'));
}

function writeDist(rootDirectory: string): void {
    mkdirSync(join(rootDirectory, 'dist', 'nested'), { recursive: true });
    writeFileSync(join(rootDirectory, 'dist', 'index.html'), '<!doctype html>\n');
    writeFileSync(join(rootDirectory, 'dist', 'nested', 'asset.txt'), 'nested-asset\n');
}

function writeVercelJson(rootDirectory: string, headers: readonly HeaderEntry[], source = '/(.*)'): void {
    writeFileSync(
        join(rootDirectory, 'vercel.json'),
        `${JSON.stringify({
            headers: [
                {
                    source,
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
        const headerSource = '/api/(.*)';
        writeVercelJson(
            rootDirectory,
            [...PRODUCTION_VERCEL_HEADERS, { key: probeName, value: probeValue }],
            headerSource
        );
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
                src: headerSource,
                headers: {
                    ...Object.fromEntries(PRODUCTION_VERCEL_HEADERS.map((header) => [header.key, header.value])),
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
        mkdirSync(join(rootDirectory, '.vercel', 'output'), { recursive: true });

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

    it('throws when dist contains no files', () => {
        const rootDirectory = makeRoot();
        roots.push(rootDirectory);
        mkdirSync(join(rootDirectory, 'dist'), { recursive: true });
        writeVercelJson(rootDirectory, [{ key: 'X-Isolation', value: 'required' }]);

        expect(() => writeVercelPrebuiltOutput(rootDirectory)).toThrow('the Vite dist directory contains no files');
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
