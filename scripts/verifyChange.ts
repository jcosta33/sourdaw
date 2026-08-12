#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type VerificationCheck = {
    id: string;
    command: string;
    args: string[];
    heavyweight: boolean;
};

type PlanOptions = {
    allowFullE2e: boolean;
    e2eSpecs: string[];
};

type CliOptions = {
    base: string;
    head: string;
    allowFullE2e: boolean;
    planOnly: boolean;
};

type LockOwner = {
    token: string;
    pid: number;
    cwd: string;
    startedAt: string;
};

export type HeavyweightLock = {
    path: string;
    release: () => void;
};

const help = `Usage: pnpm verify:change [options]

Options:
  --base <ref>       Diff base (default: origin/main)
  --head <ref>       Diff head (default: HEAD)
  --full-e2e         Explicitly authorize the full E2E suite
  --plan             Print selected checks without running them
  --help             Show this help
`;

function normalizePath(path: string): string {
    return path.replaceAll('\\', '/').replace(/^\.\//, '');
}

function isLintable(path: string): boolean {
    return /^(?:src|scripts)\/.*\.(?:[cm]?[jt]sx?)$/.test(path);
}

function isSharedWebPath(path: string): boolean {
    return (
        /^src\/(?:app|helpers|infra|utils)\//.test(path) ||
        /^src\/setupTests\.ts$/.test(path) ||
        /\/stores\//.test(path) ||
        /\/models\//.test(path)
    );
}

function isE2eHarnessPath(path: string): boolean {
    return (
        path === 'playwright.config.ts' || path === 'tests/e2e/e2eUtils.ts' || path.startsWith('tests/e2e/fixtures/')
    );
}

function changedModuleNames(paths: string[]): string[] {
    return [
        ...new Set(
            paths
                .map((path) => /^src\/modules\/([^/]+)\//.exec(path)?.[1]?.toLowerCase())
                .filter((name): name is string => name !== undefined)
        ),
    ];
}

function matchingE2eSpecs(paths: string[], e2eSpecs: string[]): string[] {
    const explicitSpecs = paths.filter((path) => /^tests\/e2e\/.*\.spec\.ts$/.test(path));
    const modules = changedModuleNames(paths);
    const moduleSpecs = e2eSpecs.filter((path) => {
        const name = basename(path).toLowerCase();
        return modules.some((moduleName) => name.startsWith(moduleName));
    });
    return [...new Set([...explicitSpecs, ...moduleSpecs])].sort();
}

function addCheck(checks: VerificationCheck[], check: VerificationCheck): void {
    if (!checks.some((candidate) => candidate.id === check.id)) {
        checks.push(check);
    }
}

export function buildVerificationPlan(rawPaths: string[], options: PlanOptions): VerificationCheck[] {
    const paths = [...new Set(rawPaths.map(normalizePath))].sort();
    const checks: VerificationCheck[] = [];
    const lintable = paths.filter(isLintable);
    const webChanged = paths.some((path) => path.startsWith('src/'));
    const scriptsChanged = paths.some((path) => path.startsWith('scripts/'));
    const serverChanged = paths.some((path) => path.startsWith('server/'));
    const rustChanged = paths.some(
        (path) => path.endsWith('.rs') || path.startsWith('crates/') || path.startsWith('src-tauri/')
    );

    if (lintable.length > 0) {
        addCheck(checks, {
            id: 'oxlint',
            command: 'pnpm',
            args: ['exec', 'oxlint', ...lintable],
            heavyweight: false,
        });
        addCheck(checks, {
            id: 'eslint',
            command: 'pnpm',
            args: ['exec', 'eslint', ...lintable],
            heavyweight: false,
        });
    }

    if (webChanged) {
        addCheck(checks, {
            id: 'typecheck-app',
            command: 'pnpm',
            args: ['typecheck'],
            heavyweight: false,
        });
        addCheck(checks, {
            id: 'typecheck-test',
            command: 'pnpm',
            args: ['typecheck:test'],
            heavyweight: false,
        });
        addCheck(checks, {
            id: 'dependency-boundaries',
            command: 'pnpm',
            args: ['deps:validate'],
            heavyweight: false,
        });
        addCheck(checks, {
            id: 'barrel-mocks',
            command: 'pnpm',
            args: ['test:barrel-mocks'],
            heavyweight: false,
        });
    }

    if (scriptsChanged) {
        addCheck(checks, {
            id: 'typecheck-scripts',
            command: 'pnpm',
            args: ['typecheck:scripts'],
            heavyweight: false,
        });
    }

    const relatedInputs = paths.filter((path) => /^(?:src|scripts)\/.*\.(?:[cm]?[jt]sx?)$/.test(path));
    if (relatedInputs.length > 0) {
        const broadWebChange = paths.some(isSharedWebPath);
        addCheck(checks, {
            id: broadWebChange ? 'vitest-full-src' : 'vitest-related',
            command: 'pnpm',
            args: broadWebChange
                ? ['test:run', '--dir', 'src', '--maxWorkers=2', '--bail=1', '--reporter=dot', '--silent=passed-only']
                : [
                      'exec',
                      'vitest',
                      'related',
                      ...relatedInputs,
                      '--run',
                      '--maxWorkers=2',
                      '--bail=1',
                      '--passWithNoTests',
                      '--reporter=dot',
                      '--silent=passed-only',
                  ],
            heavyweight: broadWebChange,
        });
    }

    if (serverChanged) {
        addCheck(checks, {
            id: 'server-test',
            command: 'npm',
            args: ['--prefix', 'server', 'test'],
            heavyweight: false,
        });
        addCheck(checks, {
            id: 'server-build',
            command: 'npm',
            args: ['--prefix', 'server', 'run', 'build'],
            heavyweight: false,
        });
    }

    if (rustChanged) {
        addCheck(checks, {
            id: 'cargo-fmt',
            command: 'cargo',
            args: ['fmt', '--all', '--check'],
            heavyweight: false,
        });
        const packages = [
            ...new Set(
                paths
                    .map((path) => {
                        const crate = /^crates\/([^/]+)\//.exec(path)?.[1];
                        if (crate !== undefined) {
                            return crate;
                        }
                        return path.startsWith('src-tauri/') ? 'sourdaw' : undefined;
                    })
                    .filter((name): name is string => name !== undefined)
            ),
        ].sort();
        for (const packageName of packages) {
            addCheck(checks, {
                id: `cargo-clippy-${packageName}`,
                command: 'cargo',
                args: ['clippy', '-p', packageName, '--all-targets', '--all-features'],
                heavyweight: true,
            });
            addCheck(checks, {
                id: `cargo-test-${packageName}`,
                command: 'cargo',
                args: ['test', '-p', packageName, '--all-features', '--', '--test-threads=2'],
                heavyweight: true,
            });
        }
    }

    const buildChanged = paths.some((path) =>
        ['index.html', 'package.json', 'pnpm-lock.yaml', 'vite.config.ts'].includes(path)
    );
    if (buildChanged) {
        addCheck(checks, {
            id: 'web-build',
            command: 'pnpm',
            args: ['build'],
            heavyweight: false,
        });
    }

    const fullE2e = options.allowFullE2e || paths.some(isE2eHarnessPath);
    const e2eSpecs = matchingE2eSpecs(paths, options.e2eSpecs);
    if (fullE2e || e2eSpecs.length > 0) {
        addCheck(checks, {
            id: fullE2e ? 'e2e-full' : 'e2e-targeted',
            command: 'pnpm',
            args: ['exec', 'playwright', 'test', ...(fullE2e ? [] : e2eSpecs), '--workers=1', '--max-failures=1'],
            heavyweight: true,
        });
    }

    return checks;
}

function lockPath(commonGitDirectory: string, root: string): string {
    const identity = createHash('sha256').update(resolve(commonGitDirectory)).digest('hex').slice(0, 16);
    return join(root, `sourdaw-heavyweight-${identity}.lock`);
}

function isProcessAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return (error as NodeJS.ErrnoException).code !== 'ESRCH';
    }
}

export function acquireHeavyweightLock(input: { commonGitDirectory: string; root?: string }): HeavyweightLock {
    const root = input.root ?? tmpdir();
    const path = lockPath(input.commonGitDirectory, root);
    const ownerPath = join(path, 'owner.json');
    const token = randomUUID();
    const candidatePath = `${path}.candidate-${token}`;
    const owner: LockOwner = {
        token,
        pid: process.pid,
        cwd: process.cwd(),
        startedAt: new Date().toISOString(),
    };
    mkdirSync(candidatePath);
    writeFileSync(join(candidatePath, 'owner.json'), `${JSON.stringify(owner, null, 2)}\n`, 'utf8');

    let published = false;
    while (!published) {
        try {
            renameSync(candidatePath, path);
            published = true;
            continue;
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code !== 'EEXIST' && code !== 'ENOTEMPTY') {
                rmSync(candidatePath, { recursive: true, force: true });
                throw error;
            }
        }

        let current: LockOwner;
        try {
            current = JSON.parse(readFileSync(ownerPath, 'utf8')) as LockOwner;
        } catch (error) {
            rmSync(candidatePath, { recursive: true, force: true });
            throw new Error(`heavyweight work is locked at ${path}; owner is not readable`, { cause: error });
        }
        if (isProcessAlive(current.pid)) {
            rmSync(candidatePath, { recursive: true, force: true });
            throw new Error(
                `heavyweight work is locked by pid ${current.pid} since ${current.startedAt} from ${current.cwd}`
            );
        }

        const stalePath = `${path}.stale-${randomUUID()}`;
        try {
            renameSync(path, stalePath);
            rmSync(stalePath, { recursive: true, force: true });
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                rmSync(candidatePath, { recursive: true, force: true });
                throw error;
            }
        }
    }

    return {
        path,
        release: () => {
            try {
                const current = JSON.parse(readFileSync(ownerPath, 'utf8')) as LockOwner;
                if (current.token === token) {
                    rmSync(path, { recursive: true, force: true });
                }
            } catch {
                // Never delete a lock whose ownership changed or cannot be proved.
            }
        },
    };
}

function run(command: string, args: string[]): void {
    console.log(`\n> ${[command, ...args].join(' ')}`);
    const result = spawnSync(command, args, { cwd: process.cwd(), stdio: 'inherit' });
    if (result.error !== undefined) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error(`${command} failed with exit ${result.status ?? 'signal'}`);
    }
}

function capture(command: string, args: string[]): string {
    const result = spawnSync(command, args, { cwd: process.cwd(), encoding: 'utf8' });
    if (result.error !== undefined) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error(result.stderr.trim() || `${command} failed with exit ${result.status ?? 'signal'}`);
    }
    return result.stdout.trim();
}

function parseArgs(args: string[]): CliOptions {
    const options: CliOptions = {
        base: 'origin/main',
        head: 'HEAD',
        allowFullE2e: false,
        planOnly: false,
    };
    for (let index = 0; index < args.length; index += 1) {
        const argument = args[index];
        if (argument === undefined) {
            break;
        }
        if (argument === '--help') {
            console.log(help);
            process.exit(0);
        }
        if (argument === '--full-e2e') {
            options.allowFullE2e = true;
            continue;
        }
        if (argument === '--plan') {
            options.planOnly = true;
            continue;
        }
        if (argument === '--base' || argument === '--head') {
            const value = args[index + 1];
            if (value === undefined) {
                throw new Error(`${argument} requires a ref`);
            }
            options[argument === '--base' ? 'base' : 'head'] = value;
            index += 1;
            continue;
        }
        throw new Error(`unknown option: ${argument}`);
    }
    return options;
}

function lines(value: string): string[] {
    return value === '' ? [] : value.split('\n').map(normalizePath);
}

function main(): number {
    try {
        const options = parseArgs(process.argv.slice(2));
        const mergeBase = capture('git', ['merge-base', options.base, options.head]);
        const changed = new Set(
            lines(capture('git', ['diff', '--name-only', '--diff-filter=ACDMRT', `${mergeBase}..${options.head}`]))
        );
        if (options.head === 'HEAD') {
            for (const path of lines(capture('git', ['diff', '--name-only', '--diff-filter=ACDMRT', 'HEAD']))) {
                changed.add(path);
            }
            for (const path of lines(capture('git', ['ls-files', '--others', '--exclude-standard']))) {
                changed.add(path);
            }
        }

        const changedPaths = [...changed].sort();
        const e2eSpecs = lines(capture('git', ['ls-files', 'tests/e2e/*.spec.ts']));
        const checks = buildVerificationPlan(changedPaths, {
            allowFullE2e: options.allowFullE2e,
            e2eSpecs,
        });

        console.log(`Changed paths: ${changedPaths.length}`);
        console.log(`Selected checks: ${checks.length}`);
        for (const check of checks) {
            console.log(`- ${check.id}${check.heavyweight ? ' [heavyweight]' : ''}`);
        }
        if (options.planOnly) {
            return 0;
        }

        run('git', ['diff', '--check', `${mergeBase}..${options.head}`]);
        if (options.head === 'HEAD') {
            run('git', ['diff', '--check', 'HEAD']);
        }

        const lightChecks = checks.filter((check) => !check.heavyweight);
        const heavyweightChecks = checks.filter((check) => check.heavyweight);
        for (const check of lightChecks) {
            run(check.command, check.args);
        }

        if (heavyweightChecks.length > 0) {
            const rawCommonGitDirectory = capture('git', ['rev-parse', '--path-format=absolute', '--git-common-dir']);
            const commonGitDirectory = isAbsolute(rawCommonGitDirectory)
                ? rawCommonGitDirectory
                : resolve(process.cwd(), rawCommonGitDirectory);
            const lock = acquireHeavyweightLock({ commonGitDirectory });
            console.log(`\nHeavyweight lock: ${lock.path}`);
            try {
                for (const check of heavyweightChecks) {
                    run(check.command, check.args);
                }
            } finally {
                lock.release();
            }
        }
        return 0;
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        return 1;
    }
}

const invokedPath = process.argv[1] === undefined ? '' : resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
    process.exit(main());
}
