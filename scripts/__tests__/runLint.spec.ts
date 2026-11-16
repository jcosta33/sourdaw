import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
    assertPluginCoverage,
    buildEslintArgv,
    buildOxlintArgv,
    buildPublicPluginsArgv,
    ensureServerDependencies,
    ESLINT_SUPPRESSIONS_FILE,
    eslintEnvironment,
    expectedPluginFiles,
    FULL_ESLINT_TARGETS,
    FULL_OXLINT_TARGETS,
    isIgnoredByPattern,
    lintConcurrency,
    lintThreads,
    parseArgs,
    parseLintedFileCount,
    publicPluginTargets,
    unignoredSourceFiles,
} from '../runLint.ts';

function cacheStrategy(argv: string[]): string | undefined {
    const index = argv.indexOf('--cache-strategy');
    return index === -1 ? undefined : argv[index + 1];
}

describe('runLint arguments', () => {
    it('requires a target unless the run is full', () => {
        expect(() => parseArgs([])).toThrow(/file target required/);
        expect(parseArgs(['--full'])).toEqual({ files: [], fix: false, full: true });
        expect(parseArgs(['src/a.ts'])).toEqual({ files: ['src/a.ts'], fix: false, full: false });
    });

    it('refuses a full-tree automatic fix', () => {
        expect(() => parseArgs(['--full', '--fix'])).toThrow(/full-tree automatic lint fixes are forbidden/);
    });
});

describe('full-run lint targets', () => {
    it('names every linted tree, so dropping one fails', () => {
        expect([...FULL_OXLINT_TARGETS]).toEqual(['src', 'scripts', 'electron', 'tests/e2e', 'server']);
        expect([...FULL_ESLINT_TARGETS]).toEqual([
            'src/**/*.{ts,tsx}',
            'scripts/**/*.ts',
            'electron/**/*.ts',
            'tests/e2e/**/*.ts',
            'server/**/*.ts',
            'scripts/lint/sourdaw.mjs',
        ]);
    });
});

describe('public plugin pass coverage', () => {
    it('hands a full run directories, because a shell-less spawn leaves globs unexpanded', () => {
        const targets = publicPluginTargets({ files: [], full: true });

        expect(targets.filter((target) => /[*?{}[\]]/.test(target))).toEqual([]);
        expect(targets).toEqual(['src', 'scripts', 'electron', 'tests/e2e', 'server']);
        expect(buildPublicPluginsArgv(targets).filter((argument) => argument.includes('*'))).toEqual([]);
    });

    it('lints the named files in a focused run', () => {
        expect(publicPluginTargets({ files: ['src/a.ts', 'scripts/b.ts'], full: false })).toEqual([
            'src/a.ts',
            'scripts/b.ts',
        ]);
    });

    it('reads the linted file count from the oxlint summary', () => {
        const summary =
            'Found 0 warnings and 0 errors.\nFinished in 1.2s on 12481 files with 102 rules using 12 threads.';

        expect(parseLintedFileCount(summary)).toBe(12_481);
        expect(parseLintedFileCount('Finished in 12ms on 1 file with 102 rules using 2 threads.')).toBe(1);
        expect(parseLintedFileCount('no summary here')).toBeUndefined();
    });

    const expectedFiles = ['src/a.ts', 'src/b.ts', 'scripts/c.ts', 'electron/d.ts'];
    const targets = ['src', 'scripts', 'electron'];

    it('fails a pass that linted fewer files than its targets track, naming both numbers', () => {
        expect(() => assertPluginCoverage(1, expectedFiles, targets)).toThrow(
            /linted 1 files but 4 tracked source files/
        );
    });

    it('fails a pass one file short, however large the tree', () => {
        expect(() => assertPluginCoverage(3, expectedFiles, targets)).toThrow(/linted 3 files but 4/);
    });

    it('fails a pass that reported no count', () => {
        expect(() => assertPluginCoverage(undefined, expectedFiles, targets)).toThrow(/no linted file count/);
    });

    it('passes a count equal to or above the tracked files, since untracked files may be linted too', () => {
        expect(() => assertPluginCoverage(4, expectedFiles, targets)).not.toThrow();
        expect(() => assertPluginCoverage(5, expectedFiles, targets)).not.toThrow();
    });

    it('fails when a directory target contributes no file, even if the total count suffices', () => {
        expect(() => assertPluginCoverage(9, ['src/a.ts', 'src/b.ts', 'scripts/c.ts'], targets)).toThrow(
            /target electron contributes no tracked source file/
        );
    });

    it('filters tracked files by trailing-slash directory patterns at any depth and by ** patterns', () => {
        const files = [
            'src/a.ts',
            'src/build/b.ts',
            'scripts/dist/c.ts',
            'electron/out/d.ts',
            'electron/out/deep/e.ts',
            'electron/main.ts',
            'src/notes.md',
            'src/modules/gen/x.js',
        ];
        const patterns = ['build/', 'dist/', 'electron/out/**', 'src/modules/gen/*.js'];

        expect(unignoredSourceFiles(files, patterns)).toEqual(['src/a.ts', 'electron/main.ts']);
        expect(isIgnoredByPattern('src/builder/a.ts', 'build/')).toBe(false);
        expect(isIgnoredByPattern('electron/outer.ts', 'electron/out/**')).toBe(false);
    });

    it('matches a slashless pattern against the basename at any depth, as gitignore does', () => {
        expect(isIgnoredByPattern('test-debug.mjs', 'test-debug.mjs')).toBe(true);
        expect(isIgnoredByPattern('scripts/tools/test-debug.mjs', 'test-debug.mjs')).toBe(true);
        expect(isIgnoredByPattern('scripts/tools/my-test-debug.mjs', 'test-debug.mjs')).toBe(false);
        expect(isIgnoredByPattern('scripts/test-debug.mjs/x.ts', 'test-debug.mjs')).toBe(false);
    });

    it('applies the live config ignorePatterns when listing the files a pass must lint', () => {
        const generatedWasm = 'src/modules/AudioEngine/wasm/daw_dsp.js';
        const tracked = spawnSync('git', ['ls-files', '--', generatedWasm], { encoding: 'utf8' }).stdout;
        expect(tracked.trim()).toBe(generatedWasm);

        const expected = expectedPluginFiles(['src/modules/AudioEngine/wasm', 'scripts/runLint.ts']);

        expect(expected).toContain('scripts/runLint.ts');
        expect(expected).not.toContain(generatedWasm);
    });

    it('expects exactly the tracked source files under the targets that its config does not ignore', () => {
        const expected = expectedPluginFiles(['scripts/lint']);

        expect(expected).toContain('scripts/lint/sourdaw.mjs');
        expect(expected.every((file) => file.startsWith('scripts/lint/'))).toBe(true);
    });
});

describe('full run through the entrypoint', () => {
    function runFull(options: { lintedFiles: number; trackedFiles: string[] }) {
        const directory = mkdtempSync(join(tmpdir(), 'run-lint-full-'));
        try {
            const argsFile = join(directory, 'git-args');
            writeFileSync(
                join(directory, 'pnpm'),
                `#!/bin/sh\nif [ "$3" = "--config=.oxlint-plugins.json" ]; then echo "plugins-args=$*"; echo "Finished in 1s on ${options.lintedFiles} files with 1 rules using 1 threads."; else echo "$2 output"; fi\n`
            );
            const tracked = options.trackedFiles.map((file) => `${file}\\0`).join('');
            writeFileSync(join(directory, 'git'), `#!/bin/sh\necho "$*" > "${argsFile}"\nprintf '${tracked}'\n`);
            chmodSync(join(directory, 'pnpm'), 0o755);
            chmodSync(join(directory, 'git'), 0o755);
            const result = spawnSync(process.execPath, [resolve('scripts/runLint.ts'), '--full'], {
                encoding: 'utf8',
                env: { ...process.env, PATH: directory },
            });
            const gitArgs = existsSync(argsFile) ? readFileSync(argsFile, 'utf8').trim() : '';
            return { result, gitArgs };
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    }

    const trackedFiles = ['src/a.ts', 'scripts/b.ts', 'electron/c.ts', 'tests/e2e/d.spec.ts', 'server/e.ts'];

    it('fails a plugin pass that lints fewer files than the targets track, before ESLint runs', () => {
        const { result } = runFull({ lintedFiles: 1, trackedFiles });

        expect(result.status).toBe(1);
        expect(result.stderr).toContain('oxlint-plugins linted 1 files but 5 tracked source files');
        expect(result.stdout).not.toContain('lint: eslint started');
    });

    it.each(['tests/e2e', 'server'])('fails a plugin pass in which %s contributes no tracked source file', (target) => {
        const { result } = runFull({
            lintedFiles: 9,
            trackedFiles: trackedFiles.filter((file) => !file.startsWith(`${target}/`)),
        });

        expect(result.status).toBe(1);
        expect(result.stderr).toContain(`oxlint-plugins target ${target} contributes no tracked source file`);
        expect(result.stdout).not.toContain('lint: eslint started');
    });

    it('lists the tracked files of the same directories it hands the plugin pass', () => {
        const { result, gitArgs } = runFull({ lintedFiles: 5, trackedFiles });

        expect(result.status, result.stderr).toBe(0);
        expect(gitArgs).toBe('ls-files -z -- src scripts electron tests/e2e server');
        expect(result.stdout).toContain('plugins-args=exec oxlint --config=.oxlint-plugins.json --quiet');
        expect(result.stdout).toMatch(/plugins-args=.* src scripts electron tests\/e2e server\n/);
        expect(result.stdout).toContain('lint: eslint passed');
    });
});

describe('eslint cache argv', () => {
    it('keys cache on file content for focused runs', () => {
        const argv = buildEslintArgv({ fix: false, full: false }, ['src/a.ts']);

        expect(argv).toContain('--cache');
        expect(cacheStrategy(argv)).toBe('content');
    });

    it('keys cache on file content for full runs', () => {
        const argv = buildEslintArgv({ fix: false, full: true }, [...FULL_ESLINT_TARGETS]);

        expect(argv).toContain('--cache');
        expect(cacheStrategy(argv)).toBe('content');
    });

    it.each([
        [{ fix: false, full: false }, ['src/a.ts']],
        [{ fix: false, full: true }, [...FULL_ESLINT_TARGETS]],
        [{ fix: true, full: false }, ['src/a.ts']],
    ])('names the committed suppressions file for %j', (options, targets) => {
        const argv = buildEslintArgv(options, targets);
        const index = argv.indexOf('--suppressions-location');

        expect(argv[index + 1]).toBe(ESLINT_SUPPRESSIONS_FILE);
        expect(existsSync(resolve(ESLINT_SUPPRESSIONS_FILE))).toBe(true);
        expect(argv).not.toContain('--pass-on-unpruned-suppressions');
    });

    it('passes fix and targets through unchanged', () => {
        const argv = buildEslintArgv({ fix: true, full: false }, ['scripts/runLint.ts'], {
            SOURDAW_LINT_CONCURRENCY: '4',
        });

        expect(argv).toContain('--fix');
        expect(argv).toContain('scripts/runLint.ts');
        expect(argv).toContain('--concurrency=4');
    });

    it('separates check and cofix caches while keeping content keys', () => {
        const check = buildEslintArgv({ fix: false, full: false }, ['src/a.ts']);
        const fix = buildEslintArgv({ fix: true, full: false }, ['src/a.ts']);
        expect(check[check.indexOf('--cache-location') + 1]).toBe('node_modules/.cache/eslint/check/');
        expect(fix[fix.indexOf('--cache-location') + 1]).toBe('node_modules/.cache/eslint/cofix/');
        expect(cacheStrategy(fix)).toBe('content');
    });
});

describe('quiet mode', () => {
    it('hides no warnings in the main oxlint pass or check-mode ESLint, since nothing is configured at warn', () => {
        expect(buildOxlintArgv({ fix: false }, ['src/a.ts'])).not.toContain('--quiet');
        expect(buildOxlintArgv({ fix: true }, ['src/a.ts'])).not.toContain('--quiet');
        expect(buildEslintArgv({ fix: false, full: false }, ['src/a.ts'])).not.toContain('--quiet');
        expect(buildEslintArgv({ fix: false, full: true }, [...FULL_ESLINT_TARGETS])).not.toContain('--quiet');
    });

    it('keeps fix-mode ESLint and the public plugins pass quiet to hide the size-baseline ratchet', () => {
        expect(buildEslintArgv({ fix: true, full: false }, ['src/a.ts'])).toContain('--quiet');
        expect(buildPublicPluginsArgv(['src/a.ts'])).toContain('--quiet');
    });
});

describe('linter parallelism', () => {
    it('runs on one worker by default, which is the agent-session ceiling', () => {
        expect(lintConcurrency({})).toBe('off');
        expect(lintThreads({})).toBe('2');
    });

    it('takes the worker count from the environment where there is no such ceiling', () => {
        expect(lintConcurrency({ SOURDAW_LINT_CONCURRENCY: 'auto' })).toBe('auto');
        expect(lintConcurrency({ SOURDAW_LINT_CONCURRENCY: '4' })).toBe('4');
        expect(lintThreads({ SOURDAW_LINT_THREADS: '0' })).toBe('0');
    });
});

describe('eslint heap ceiling', () => {
    it('raises the ceiling when nothing else has set one', () => {
        expect(eslintEnvironment({}).NODE_OPTIONS).toBe('--max-old-space-size=6144');
    });

    it('defers to an ancestor that already set one', () => {
        // `pnpm guard` is that ancestor. V8 honours the last occurrence of a
        // repeated flag, so appending a larger value would silently defeat the
        // ceiling rather than raise a default.
        const guarded = { NODE_OPTIONS: '--max-old-space-size=2048' };

        expect(eslintEnvironment(guarded).NODE_OPTIONS).toBe(guarded.NODE_OPTIONS);
        expect(guarded).toEqual({ NODE_OPTIONS: '--max-old-space-size=2048' });
    });

    it('keeps unrelated node options', () => {
        expect(eslintEnvironment({ NODE_OPTIONS: '--enable-source-maps' }).NODE_OPTIONS).toBe(
            '--enable-source-maps --max-old-space-size=6144'
        );
    });

    it('selects cofix explicitly and removes inherited cofix intent from checks', () => {
        const source = { SOURDAW_LINT_COFIX: '1', NODE_OPTIONS: '--max-old-space-size=2048' };
        expect(eslintEnvironment(source).SOURDAW_LINT_COFIX).toBe('0');
        expect(eslintEnvironment(source, true).SOURDAW_LINT_COFIX).toBe('1');
        expect(source).toEqual({ SOURDAW_LINT_COFIX: '1', NODE_OPTIONS: '--max-old-space-size=2048' });
    });
});

describe('ensureServerDependencies', () => {
    it('does nothing when targets contain no server files', () => {
        const existsSyncMock = vi.fn().mockReturnValue(false);
        const spawnSyncMock = vi.fn();

        const result = ensureServerDependencies(
            ['src/app.ts', 'scripts/test.ts'],
            '/repo',
            existsSyncMock,
            spawnSyncMock as any
        );

        expect(result).toBe(false);
        expect(existsSyncMock).not.toHaveBeenCalled();
        expect(spawnSyncMock).not.toHaveBeenCalled();
    });

    it('does nothing when server/node_modules already exists', () => {
        const existsSyncMock = vi.fn().mockReturnValue(true);
        const spawnSyncMock = vi.fn();

        const result = ensureServerDependencies(
            ['server/collab-server.ts'],
            '/repo',
            existsSyncMock,
            spawnSyncMock as any
        );

        expect(result).toBe(false);
        expect(existsSyncMock).toHaveBeenCalled();
        expect(spawnSyncMock).not.toHaveBeenCalled();
    });

    it('installs server dependencies when server targets are present and node_modules is missing', () => {
        const existsSyncMock = vi.fn().mockReturnValue(false);
        const spawnSyncMock = vi.fn().mockReturnValue({ status: 0 });

        const result = ensureServerDependencies(
            ['server/collab-server.ts'],
            '/repo',
            existsSyncMock,
            spawnSyncMock as any
        );

        expect(result).toBe(true);
        expect(existsSyncMock).toHaveBeenCalled();
        expect(spawnSyncMock).toHaveBeenCalledWith('npm', ['--prefix', 'server', 'ci', '--include=dev'], {
            stdio: 'inherit',
            cwd: '/repo',
        });
    });

    it('throws an error if npm ci fails', () => {
        const existsSyncMock = vi.fn().mockReturnValue(false);
        const spawnSyncMock = vi.fn().mockReturnValue({ status: 1 });

        expect(() => ensureServerDependencies(['server'], '/repo', existsSyncMock, spawnSyncMock as any)).toThrow(
            'failed to install server dependencies for linting'
        );
    });
});

describe('lint entrypoint phase reporting', () => {
    function runLint(failingEngine = '', fix = false) {
        const directory = mkdtempSync(join(tmpdir(), 'run-lint-test-'));
        try {
            const executable = join(directory, 'pnpm');
            writeFileSync(
                executable,
                '#!/bin/sh\nengine="$2"\nif [ "$3" = "--config=.oxlint-plugins.json" ]; then engine="oxlint-plugins"; fi\necho "$engine output"\nif [ "$engine" = "$FAIL_ENGINE" ]; then exit 2; fi\nif [ "$REPORT_CONFIG" = "1" ] && [ "$engine" = "eslint" ]; then echo "cofix=$SOURDAW_LINT_COFIX args=$*"; fi\nif [ "$REPORT_CONFIG" = "1" ] && [ "$engine" = "oxlint-plugins" ]; then echo "public-args=$*"; fi\n'
            );
            chmodSync(executable, 0o755);
            const args = [resolve('scripts/runLint.ts'), 'src/a.ts'];
            if (fix) {
                args.push('--fix');
            }
            return spawnSync(process.execPath, args, {
                encoding: 'utf8',
                env: {
                    ...process.env,
                    PATH: directory,
                    FAIL_ENGINE: failingEngine,
                    REPORT_CONFIG: fix ? '1' : '0',
                    SOURDAW_LINT_COFIX: '1',
                },
            });
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    }

    it('reports each subprocess in order around its output', () => {
        const result = runLint();

        expect(result.status).toBe(0);
        expect(result.stderr).toBe('');
        expect(result.stdout).toMatch(
            /^lint: oxlint started\noxlint output\nlint: oxlint passed \(\d+ ms\)\nlint: oxlint-plugins started\noxlint-plugins output\nlint: oxlint-plugins passed \(\d+ ms\)\nlint: eslint started\neslint output\nlint: eslint passed \(\d+ ms\)\n$/
        );
    });

    it('routes fixes through ESLint cofix before a non-fixing public-plugin validation', () => {
        const result = runLint('', true);
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toMatch(/lint: oxlint passed[^]*lint: eslint started/);
        expect(result.stdout).toMatch(/lint: eslint passed[^]*lint: oxlint-plugins started/);
        expect(result.stdout).toContain('cofix=1 args=exec eslint');
        expect(result.stdout).toContain('node_modules/.cache/eslint/cofix/');
        expect(result.stdout).toContain('--fix src/a.ts');
        const publicArgs = result.stdout.split('\n').find((line) => line.startsWith('public-args='));
        expect(publicArgs).toContain('--config=.oxlint-plugins.json');
        expect(publicArgs).not.toContain('--fix');
    });

    it('retains fail-fast reporting when the explicit cofix engine fails', () => {
        const result = runLint('eslint', true);
        expect(result.status).toBe(1);
        expect(result.stderr).toBe('eslint failed\n');
        expect(result.stdout).toContain('lint: eslint failed');
        expect(result.stdout).not.toContain('oxlint-plugins');
    });

    it('fails if final public validation rejects the fixed bytes', () => {
        const result = runLint('oxlint-plugins', true);
        expect(result.status).toBe(1);
        expect(result.stderr).toBe('oxlint-plugins failed\n');
        expect(result.stdout).toMatch(/lint: eslint passed[^]*lint: oxlint-plugins failed/);
    });

    it.each(['oxlint', 'oxlint-plugins', 'eslint'])('reports %s failure and retains the original error', (engine) => {
        const result = runLint(engine);

        expect(result.status).toBe(1);
        expect(result.stderr).toBe(`${engine} failed\n`);
        expect(result.stdout).toMatch(
            new RegExp(`lint: ${engine} started\\n${engine} output\\nlint: ${engine} failed \\(\\d+ ms\\)`)
        );
        expect(result.stdout).not.toContain(`lint: ${engine} passed`);
        if (engine !== 'eslint') {
            expect(result.stdout).not.toContain('eslint');
        }
        if (engine === 'oxlint') {
            expect(result.stdout).not.toContain('oxlint-plugins');
        }
    });
});
