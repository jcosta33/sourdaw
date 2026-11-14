// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { installedGraph } from '../dependencyPorts/jsToolingInstalled.mjs';
const repository = resolve(import.meta.dirname, '../..');
const fixtures = join(import.meta.dirname, 'fixtures/jsFinalDependencyPorts');
const graph = installedGraph(repository);
function run(
    script: string,
    args: string[] = [],
    extra: Record<string, string> = {},
    cwd = repository,
    nodeArgs: string[] = []
) {
    const result = spawnSync(process.execPath, [...nodeArgs, script, ...args], {
        cwd,
        env: { ...process.env, ...extra },
        encoding: 'utf8',
        timeout: 60_000,
        maxBuffer: 8 * 1024 * 1024,
    });
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    return result.stdout;
}
describe('final installed development dependency consumers', () => {
    it('preserves original Babel generated maps, ranges, contents and getter ordering', () => {
        const environment = { GENERATOR_PACKAGE: join(graph.packageRoot('@babel/generator', '8.1.2'), 'package.json') };
        run(join(fixtures, 'mapping/fixture.mjs'), ['compare', join(fixtures, 'mapping/baseline.json')], environment);
        expect(run(join(fixtures, 'mapping/extended.mjs'), ['compare'], environment)).toContain('six getter orders');
        expect(run(join(fixtures, 'mapping/types.mjs'))).toContain('native mapping declarations');
    });
    it('accepts real Electron APIs with native Node26 types and rejects invalid options', () => {
        expect(run(join(fixtures, 'electron-types.mjs'))).toContain('Electron real Node26 declarations');
    }, 65_000);
    it('runs actual Tailwind embedded WASI scanner, physical packages and repeated GC inputs', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-tailwind-contract-'));
        try {
            const output = run(
                join(fixtures, 'tailwind.cjs'),
                [root],
                {
                    TAILWIND_VITE_PACKAGE: join(graph.packageRoot('@tailwindcss/vite'), 'package.json'),
                },
                repository,
                ['--expose-gc']
            );
            const observed: unknown = JSON.parse(output);
            expect(observed).toHaveProperty(['repeated', 'length'], 20);
            expect(observed).toMatchObject({
                errors: [{ message: expect.stringContaining('extension') }, { name: 'RuntimeError' }, { result: [] }],
            });
            for (const [name, version] of Object.entries({
                '@emnapi/core': '1.11.3',
                '@emnapi/runtime': '1.11.3',
                '@emnapi/wasi-threads': '2.2.0',
                '@napi-rs/wasm-runtime': '1.2.7',
                '@tybys/wasm-util': '0.10.4',
                tslib: '2.9.1',
            }))
                expect(observed).toHaveProperty(['versions', name, 'version'], version);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    }, 65_000);
    it('loads real runner lexer initialization failures and hanging-resource reporter', () => {
        expect(run(join(fixtures, 'runner/lexer-init-failure.mjs'))).toContain(
            'propagates synchronous initialization failure'
        );
        expect(run(join(fixtures, 'runner/held-resource-reporter.mjs'))).toContain('printed live Timeout');
    });
    it('preserves actual Commander generated config and global CLI warning', () => {
        expect(run(join(fixtures, 'commander.mjs'))).toContain('CLI help/options/JSON/config/global-warning passed');
    }, 65_000);
    it.each(['isValidNodeImport', 'detectModuleType'])('initializes actual asynchronous lexer consumer %s', (name) => {
        expect(run(join(fixtures, 'runner/async-consumers.mjs'), [name])).toContain(
            'initializes real lexer asynchronously'
        );
    });
    it.each(['forks', 'vmForks', 'vmForks-init-error'])(
        'collects real mocks and module boundaries through %s',
        (pool) => {
            const root = mkdtempSync(join(tmpdir(), 'sourdaw-runner-contract-'));
            try {
                mkdirSync(join(root, 'cases'));
                mkdirSync(join(root, 'node_modules'));
                symlinkSync(graph.packageRoot('vitest'), join(root, 'node_modules/vitest'), 'junction');
                for (const [name, target] of [
                    ['runner-fixture', 'external-package'],
                    ['runner-esm-scope-fixture', 'external-esm-scope'],
                ])
                    cpSync(join(fixtures, 'runner', target), join(root, 'node_modules', name), { recursive: true });
                cpSync(join(fixtures, 'runner/modules'), join(root, 'modules'), { recursive: true });
                const names =
                    pool === 'forks'
                        ? ['lexer.spec.ts', 'mock-target.ts']
                        : ['lexer.spec.ts', 'vm-scope.spec.ts', 'mock-target.ts'];
                for (const name of names)
                    writeFileSync(join(root, 'cases', name), readFileSync(join(fixtures, 'runner', name + '.txt')));
                writeFileSync(
                    join(root, 'vitest.config.mjs'),
                    `export default {test:{root:${JSON.stringify(root)},environment:'node',include:['cases/*.spec.ts'],exclude:[],maxWorkers:2,pool:${JSON.stringify(pool === 'forks' ? 'forks' : 'vmForks')},execArgv:${JSON.stringify(pool === 'vmForks-init-error' ? ['--require', join(fixtures, 'runner/fail-wasm.cjs')] : [])}}};\n`
                );
                if (pool === 'vmForks-init-error') {
                    const result = spawnSync(
                        process.execPath,
                        [
                            join(repository, 'scripts/runVitestZeroTestGuard.ts'),
                            '--config',
                            join(root, 'vitest.config.mjs'),
                        ],
                        {
                            cwd: repository,
                            env: process.env,
                            encoding: 'utf8',
                            timeout: 30000,
                            maxBuffer: 8 * 1024 * 1024,
                        }
                    );
                    expect(result.error).toBeUndefined();
                    expect(result.signal).toBeNull();
                    expect(result.status).toBe(1);
                    expect(result.stdout + result.stderr).toContain('lexer WASM initialization sentinel');
                    expect(result.stdout + result.stderr).toContain('FAIL  cases/vm-scope.spec.ts');
                    expect(result.stdout + result.stderr).toContain('node_modules/runner-esm-scope-fixture/index.cjs');
                    expect(result.stdout + result.stderr).toContain('1 failed | 4 passed');
                } else {
                    const output = run(join(repository, 'scripts/runVitestZeroTestGuard.ts'), [
                        '--config',
                        join(root, 'vitest.config.mjs'),
                    ]);
                    expect(output).toContain(pool === 'forks' ? '4 passed' : '5 passed');
                }
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        },
        65_000
    );
});
