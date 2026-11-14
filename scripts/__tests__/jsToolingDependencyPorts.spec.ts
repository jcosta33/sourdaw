// @vitest-environment node

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const repository = resolve(import.meta.dirname, '../..');
const fixtures = join(import.meta.dirname, 'fixtures/jsToolingDependencyPorts');
const privateRoot = mkdtempSync(join(tmpdir(), 'sourdaw-dependency-contracts-'));
let vectors = '';
const environment = () => ({
    ...process.env,
    PACKAGING_REQUIRE_FROM: join(repository, 'package.json'),
    CACHE_REQUIRE_FROM: join(repository, 'package.json'),
    PACKAGING_PFX_FIXTURES: vectors,
});

function run(script: string, args: string[] = []) {
    const result = spawnSync(process.execPath, [script, ...args], {
        cwd: repository,
        env: environment(),
        encoding: 'utf8',
        timeout: 60_000,
        maxBuffer: 8 * 1024 * 1024,
    });
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    return result.stdout;
}

beforeAll(() => {
    const result = spawnSync('sh', [join(fixtures, 'packaging/fixtures/prepare-independent-pfx.sh')], {
        cwd: repository,
        env: { ...environment(), PACKAGING_PFX_OUTPUT: privateRoot },
        encoding: 'utf8',
        timeout: 60_000,
        maxBuffer: 4 * 1024 * 1024,
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    vectors = result.stdout.trim().split('\n').at(-1) ?? '';
    expect(vectors.startsWith(privateRoot)).toBe(true);
}, 65_000);

afterAll(() => rmSync(privateRoot, { recursive: true, force: true }));

describe('installed development and packaging consumer ports', () => {
    it('binds every installed package byte and qualified physical parent edge', () => {
        const output = run(join(repository, 'scripts/dependencyPorts/verifyJsToolingInstalled.mjs'));
        expect(output).toContain('"coherentOxcOptionals":19');
    });

    it.each([
        'artifact-download',
        'artifact-transport',
        'bounded-closure',
        'builder-behavior',
        'cache-errors-hooks',
        'certificate-provider',
        'cli-options',
        'closure-values',
        'eslint-cache-path',
        'file-cache-values',
        'flatpak-files',
        'independent-pfx',
        'memory-keyv-values',
        'multipart',
        'native-abort',
        'packaging-values',
        'pool-routes',
        'source-map-indexed-values',
        'source-map-stack',
        'squirrel-closure',
        'windows-sign-closure',
    ])(
        'preserves actual packaging %s values and failures',
        (name) => {
            const output = run(join(fixtures, 'packaging/cases', `${name}.test.cjs`));
            expect(output).toMatch(/# fail 0|ℹ fail 0/);
            expect(output).toMatch(/# pass [1-9]|ℹ pass [1-9]/);
        },
        65_000
    );

    it.each([
        ['types.mjs', 'native Node and Undici strict declarations passed'],
        ['build-tools.mjs', 'actual Vite compiler chunks, worker, asset, maps and Knip OXC enumeration passed'],
        ['wasi/run.mjs', 'real WASI constructor rollback, ten scheduler routes and async-plugin reuse passed'],
        ['react/fixture.mjs', 'PASS real React Hooks preset diagnostics'],
        ['react/hooks-extra.mjs', 'PASS configured compiler catches unconditional render state update'],
        ['react/reservation-fixture.mjs', 'PASS composed map'],
    ])(
        'preserves actual %s contracts',
        (script, observable) => {
            expect(run(join(fixtures, script))).toContain(observable);
        },
        65_000
    );

    it.each(['schemas', 'enumeration', 'rules', 'cacheAndCli'])(
        'preserves ESLint %s through native Ajv',
        (scenario) => {
            const output = run(join(fixtures, 'lint/core.mjs'), [scenario]);
            expect(output.trim()).toBe(JSON.stringify({ case: scenario, platform: process.platform, complete: true }));
        },
        65_000
    );

    it('preserves positive alias resolution and reports missing and unordered imports', () => {
        expect(run(join(fixtures, 'lint/imports.mjs'))).toContain('"complete":true');
    });

    it.each([
        ['width-oracle.cjs', 'literal cell-width oracle passed'],
        ['debug-modes.mjs', 'debug real stderr colored and quiet noncolor formats passed'],
        ['narrow-prompt.mjs', 'narrow real prompt clear, submit and cleanup passed'],
        ['prompt-validation.mjs', 'validation retry, injected submit/cancel and invalid type passed'],
        ['prefix-cases.mjs', 'seven private POSIX prefix, precedence, yarn, pnpm and local-install assertions passed'],
        ['cli-smoke.mjs', 'CLI help, version, invalid option and local JSON graph passed'],
    ])(
        'preserves actual CLI %s behavior',
        (script, observable) => {
            expect(run(join(fixtures, 'cli', script))).toContain(observable);
        },
        65_000
    );
});
