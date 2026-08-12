#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type VerificationCheck = {
    id: string;
    command: string;
    args: string[];
    heavyweight: boolean;
    reason: string;
};

export type ChangedPath = {
    path: string;
    present: boolean;
};

type PlanOptions = {
    allowFullE2e: boolean;
    requestedE2e: string[];
    cargoPackages: string[];
};

type CliOptions = {
    base: string;
    head: string;
    allowFullE2e: boolean;
    requestedE2e: string[];
    planOnly: boolean;
};

type LockOwner = {
    token: string;
    pid: number;
    cwd: string;
    startedAt: string;
    processStartedAt: string;
};

export type HeavyweightLock = {
    path: string;
    release: () => void;
};

const help = `Usage: pnpm verify:change [options]

Options:
  --base <ref>       Diff base (default: origin/main)
  --head <ref>       Diff head (default: HEAD)
  --e2e <spec>       Add one targeted E2E spec; repeat as needed
  --full-e2e         Explicitly authorize the full E2E suite
  --plan             Print paths, reasons, and commands without running them
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

function addCheck(checks: VerificationCheck[], check: VerificationCheck): void {
    if (!checks.some((candidate) => candidate.id === check.id)) {
        checks.push(check);
    }
}

export function buildVerificationPlan(rawChanges: ChangedPath[], options: PlanOptions): VerificationCheck[] {
    const changeMap = new Map<string, ChangedPath>();
    for (const change of rawChanges) {
        const path = normalizePath(change.path);
        changeMap.set(path, { path, present: change.present });
    }
    const changes = [...changeMap.values()].sort((left, right) => left.path.localeCompare(right.path));
    const paths = changes.map((change) => change.path);
    const presentPaths = changes.filter((change) => change.present).map((change) => change.path);
    const checks: VerificationCheck[] = [];
    const lintable = presentPaths.filter(isLintable);
    const webChanged = paths.some((path) => path.startsWith('src/'));
    const scriptsChanged = paths.some((path) => path.startsWith('scripts/'));
    const serverChanged = paths.some((path) => path.startsWith('server/'));

    if (lintable.length > 0) {
        addCheck(checks, {
            id: 'oxlint',
            command: 'pnpm',
            args: ['exec', 'oxlint', ...lintable],
            heavyweight: false,
            reason: 'lint changed files that still exist',
        });
        addCheck(checks, {
            id: 'eslint',
            command: 'pnpm',
            args: ['exec', 'eslint', ...lintable],
            heavyweight: false,
            reason: 'run retained lint rules on changed files that still exist',
        });
    }

    if (webChanged) {
        addCheck(checks, {
            id: 'typecheck-app',
            command: 'pnpm',
            args: ['typecheck'],
            heavyweight: false,
            reason: 'web source changed',
        });
        addCheck(checks, {
            id: 'typecheck-test',
            command: 'pnpm',
            args: ['typecheck:test'],
            heavyweight: false,
            reason: 'web source changed',
        });
        addCheck(checks, {
            id: 'dependency-boundaries',
            command: 'pnpm',
            args: ['deps:validate'],
            heavyweight: false,
            reason: 'web dependency edges may have changed',
        });
        addCheck(checks, {
            id: 'barrel-mocks',
            command: 'pnpm',
            args: ['test:barrel-mocks'],
            heavyweight: false,
            reason: 'web imports may affect contract-barrel mocks',
        });
    }

    if (scriptsChanged) {
        addCheck(checks, {
            id: 'typecheck-scripts',
            command: 'pnpm',
            args: ['typecheck:scripts'],
            heavyweight: false,
            reason: 'repository tooling changed',
        });
    }

    const srcInputs = presentPaths.filter((path) => /^src\/.*\.(?:[cm]?[jt]sx?)$/.test(path));
    const scriptInputs = presentPaths.filter((path) => /^scripts\/.*\.(?:[cm]?[jt]sx?)$/.test(path));
    const deletedSrc = changes.some((change) => !change.present && /^src\/.*\.(?:[cm]?[jt]sx?)$/.test(change.path));
    const deletedScript = changes.some(
        (change) => !change.present && /^scripts\/.*\.(?:[cm]?[jt]sx?)$/.test(change.path)
    );
    if (srcInputs.length > 0 || deletedSrc) {
        const broadWebChange = deletedSrc || paths.some(isSharedWebPath);
        addCheck(checks, {
            id: broadWebChange ? 'vitest-full-src' : 'vitest-related-src',
            command: 'pnpm',
            args: broadWebChange
                ? ['test:run', '--dir', 'src', '--maxWorkers=2', '--bail=1', '--reporter=dot', '--silent=passed-only']
                : [
                      'exec',
                      'vitest',
                      'related',
                      ...srcInputs,
                      '--run',
                      '--maxWorkers=2',
                      '--bail=1',
                      '--passWithNoTests',
                      '--reporter=dot',
                      '--silent=passed-only',
                  ],
            heavyweight: broadWebChange,
            reason: broadWebChange
                ? 'shared or deleted web source requires the source suite'
                : 'run tests related to changed web source',
        });
    }

    if (scriptInputs.length > 0 || deletedScript) {
        addCheck(checks, {
            id: deletedScript ? 'vitest-full-scripts' : 'vitest-related-scripts',
            command: 'pnpm',
            args: deletedScript
                ? [
                      'test:run',
                      '--dir',
                      'scripts',
                      '--maxWorkers=2',
                      '--bail=1',
                      '--reporter=dot',
                      '--silent=passed-only',
                  ]
                : [
                      'exec',
                      'vitest',
                      'related',
                      ...scriptInputs,
                      '--run',
                      '--dir',
                      'scripts',
                      '--maxWorkers=2',
                      '--bail=1',
                      '--passWithNoTests',
                      '--reporter=dot',
                      '--silent=passed-only',
                  ],
            heavyweight: deletedScript,
            reason: deletedScript
                ? 'deleted tooling requires the scripts suite'
                : 'run tests related to changed tooling',
        });
    }

    if (serverChanged) {
        addCheck(checks, {
            id: 'server-test',
            command: 'npm',
            args: ['--prefix', 'server', 'test'],
            heavyweight: false,
            reason: 'collaboration server changed',
        });
        addCheck(checks, {
            id: 'server-build',
            command: 'npm',
            args: ['--prefix', 'server', 'run', 'build'],
            heavyweight: false,
            reason: 'collaboration server changed',
        });
    }

    if (options.cargoPackages.length > 0) {
        addCheck(checks, {
            id: 'cargo-fmt',
            command: 'cargo',
            args: ['fmt', '--all', '--check'],
            heavyweight: false,
            reason: 'Rust workspace changed',
        });
        for (const packageName of [...new Set(options.cargoPackages)].sort()) {
            addCheck(checks, {
                id: `cargo-clippy-${packageName}`,
                command: 'cargo',
                args: ['clippy', '-p', packageName, '--all-targets', '--all-features'],
                heavyweight: true,
                reason: `${packageName} or one of its local dependencies changed`,
            });
            addCheck(checks, {
                id: `cargo-test-${packageName}`,
                command: 'cargo',
                args: ['test', '-p', packageName, '--all-features', '--', '--test-threads=2'],
                heavyweight: true,
                reason: `${packageName} or one of its local dependencies changed`,
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
            reason: 'web build inputs changed',
        });
    }

    const fullE2e = options.allowFullE2e || paths.some(isE2eHarnessPath);
    const changedE2e = presentPaths.filter((path) => /^tests\/e2e\/.*\.spec\.ts$/.test(path));
    const e2eSpecs = [...new Set([...changedE2e, ...options.requestedE2e])].sort();
    if (fullE2e || e2eSpecs.length > 0) {
        addCheck(checks, {
            id: fullE2e ? 'e2e-full' : 'e2e-targeted',
            command: 'pnpm',
            args: ['exec', 'playwright', 'test', ...(fullE2e ? [] : e2eSpecs), '--workers=1', '--max-failures=1'],
            heavyweight: true,
            reason: fullE2e
                ? 'E2E harness changed or full E2E was explicitly authorized'
                : 'run only selected E2E specs',
        });
    }

    return checks;
}

function lockPath(commonGitDirectory: string, root: string): string {
    const identity = createHash('sha256').update(resolve(commonGitDirectory)).digest('hex').slice(0, 16);
    return join(root, `sourdaw-heavyweight-${identity}.lock`);
}

function processStartedAt(pid: number): string | undefined {
    const result = spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8' });
    if (result.status !== 0) {
        return undefined;
    }
    return result.stdout.trim() || undefined;
}

function isCurrentProcess(owner: LockOwner): boolean {
    try {
        process.kill(owner.pid, 0);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
            return false;
        }
        return true;
    }
    const currentStart = processStartedAt(owner.pid);
    return (
        currentStart === undefined ||
        typeof owner.processStartedAt !== 'string' ||
        currentStart === owner.processStartedAt
    );
}

export function acquireHeavyweightLock(input: { commonGitDirectory: string; root?: string }): HeavyweightLock {
    const root = input.root ?? tmpdir();
    const path = lockPath(input.commonGitDirectory, root);
    const ownerPath = join(path, 'owner.json');
    const token = randomUUID();
    const candidatePath = `${path}.candidate-${token}`;
    const currentProcessStart = processStartedAt(process.pid);
    if (currentProcessStart === undefined) {
        throw new Error('cannot identify the current process for heavyweight admission');
    }
    const owner: LockOwner = {
        token,
        pid: process.pid,
        cwd: process.cwd(),
        startedAt: new Date().toISOString(),
        processStartedAt: currentProcessStart,
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
        if (isCurrentProcess(current)) {
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

function captureRaw(command: string, args: string[]): string {
    const result = spawnSync(command, args, { cwd: process.cwd(), encoding: 'utf8' });
    if (result.error !== undefined) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error(result.stderr.trim() || `${command} failed with exit ${result.status ?? 'signal'}`);
    }
    return result.stdout;
}

export function parseNameStatus(raw: string): ChangedPath[] {
    const fields = raw.split('\0');
    if (fields.at(-1) === '') {
        fields.pop();
    }
    const changes: ChangedPath[] = [];
    for (let index = 0; index < fields.length;) {
        const status = fields[index];
        const firstPath = fields[index + 1];
        if (status === undefined || firstPath === undefined) {
            throw new Error('git returned malformed name-status data');
        }
        if (status.startsWith('R')) {
            const secondPath = fields[index + 2];
            if (secondPath === undefined) {
                throw new Error('git returned a rename without a destination');
            }
            changes.push({ path: firstPath, present: false }, { path: secondPath, present: true });
            index += 3;
            continue;
        }
        if (status.startsWith('C')) {
            const secondPath = fields[index + 2];
            if (secondPath === undefined) {
                throw new Error('git returned a copy without a destination');
            }
            changes.push({ path: secondPath, present: true });
            index += 3;
            continue;
        }
        changes.push({ path: firstPath, present: status !== 'D' });
        index += 2;
    }
    return changes;
}

function isRustPath(path: string): boolean {
    return (
        path === 'Cargo.toml' ||
        path === 'Cargo.lock' ||
        path === 'rust-toolchain.toml' ||
        path.startsWith('.cargo/') ||
        path.startsWith('crates/') ||
        path.startsWith('src-tauri/') ||
        path.endsWith('.rs')
    );
}

type CargoMetadata = {
    packages: Array<{
        name: string;
        manifest_path: string;
        dependencies: Array<{ name: string; path?: string | null }>;
    }>;
};

export function affectedCargoPackages(changes: ChangedPath[]): string[] {
    const rustPaths = changes.map((change) => change.path).filter(isRustPath);
    if (rustPaths.length === 0) {
        return [];
    }

    const repositoryRoot = capture('git', ['rev-parse', '--show-toplevel']);
    const metadata = JSON.parse(capture('cargo', ['metadata', '--no-deps', '--format-version=1'])) as CargoMetadata;
    const packagesByName = new Map(metadata.packages.map((pkg) => [pkg.name, pkg]));
    const allPackages = [...packagesByName.keys()];
    const rootControlChanged = rustPaths.some(
        (path) =>
            path === 'Cargo.toml' ||
            path === 'Cargo.lock' ||
            path === 'rust-toolchain.toml' ||
            path.startsWith('.cargo/')
    );
    const affected = new Set<string>(rootControlChanged ? allPackages : []);

    for (const pkg of metadata.packages) {
        const packageDirectory = normalizePath(relative(repositoryRoot, dirname(pkg.manifest_path)));
        if (
            rustPaths.some(
                (path) => path === `${packageDirectory}/Cargo.toml` || path.startsWith(`${packageDirectory}/`)
            )
        ) {
            affected.add(pkg.name);
        }
    }

    const reverse = new Map<string, Set<string>>();
    for (const pkg of metadata.packages) {
        for (const dependency of pkg.dependencies) {
            if (dependency.path === null || dependency.path === undefined || !packagesByName.has(dependency.name)) {
                continue;
            }
            const dependents = reverse.get(dependency.name) ?? new Set<string>();
            dependents.add(pkg.name);
            reverse.set(dependency.name, dependents);
        }
    }

    const queue = [...affected];
    for (let index = 0; index < queue.length; index += 1) {
        const packageName = queue[index];
        if (packageName === undefined) {
            continue;
        }
        for (const dependent of reverse.get(packageName) ?? []) {
            if (!affected.has(dependent)) {
                affected.add(dependent);
                queue.push(dependent);
            }
        }
    }
    return [...affected].sort();
}

function parseArgs(args: string[]): CliOptions {
    const options: CliOptions = {
        base: 'origin/main',
        head: 'HEAD',
        allowFullE2e: false,
        requestedE2e: [],
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
        if (argument === '--base' || argument === '--head' || argument === '--e2e') {
            const value = args[index + 1];
            if (value === undefined) {
                throw new Error(`${argument} requires a ref`);
            }
            if (argument === '--e2e') {
                options.requestedE2e.push(normalizePath(value));
            } else {
                options[argument === '--base' ? 'base' : 'head'] = value;
            }
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

function formatCommand(check: VerificationCheck): string {
    return [check.command, ...check.args].map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(' ');
}

function main(): number {
    try {
        const options = parseArgs(process.argv.slice(2));
        const mergeBase = capture('git', ['merge-base', options.base, options.head]);
        const changed = new Map<string, ChangedPath>();
        const mergeChanges = (incoming: ChangedPath[]) => {
            for (const change of incoming) {
                const normalized = { path: normalizePath(change.path), present: change.present };
                changed.set(normalized.path, normalized);
            }
        };
        mergeChanges(
            parseNameStatus(captureRaw('git', ['diff', '--name-status', '-z', '-M', `${mergeBase}..${options.head}`]))
        );
        if (options.head === 'HEAD') {
            mergeChanges(parseNameStatus(captureRaw('git', ['diff', '--name-status', '-z', '-M', 'HEAD'])));
            for (const path of captureRaw('git', ['ls-files', '--others', '--exclude-standard', '-z']).split('\0')) {
                if (path !== '') {
                    mergeChanges([{ path, present: true }]);
                }
            }
        }

        const changedPaths = [...changed.values()].sort((left, right) => left.path.localeCompare(right.path));
        const e2eSpecs = lines(capture('git', ['ls-files', 'tests/e2e/*.spec.ts']));
        for (const requested of options.requestedE2e) {
            if (!e2eSpecs.includes(requested)) {
                throw new Error(`targeted E2E spec is not tracked: ${requested}`);
            }
        }
        const checks = buildVerificationPlan(changedPaths, {
            allowFullE2e: options.allowFullE2e,
            requestedE2e: options.requestedE2e,
            cargoPackages: affectedCargoPackages(changedPaths),
        });

        console.log('Changed paths:');
        for (const change of changedPaths) {
            console.log(`- ${change.present ? 'present' : 'deleted'}: ${change.path}`);
        }
        console.log('\nSelected checks:');
        for (const check of checks) {
            console.log(`- ${check.id}${check.heavyweight ? ' [heavyweight]' : ''}: ${check.reason}`);
            console.log(`  ${formatCommand(check)}`);
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
