#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import {
    closeSync,
    existsSync,
    fsyncSync,
    lstatSync,
    mkdirSync,
    openSync,
    readdirSync,
    readFileSync,
    realpathSync,
    renameSync,
    writeFileSync,
} from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { unsafeCredentialReason } from './evidenceSafety.ts';
import {
    assertRequiredRepository,
    assertTrustedExecutingBlob,
    authenticateRole,
    githubAuthorizationGitEnv,
    originMainBlob,
    REQUIRED_REPOSITORY,
    resolvePrimaryRoot,
    spawnCapture,
    spawnRun,
} from './githubAppIdentity.ts';
import {
    capture as captureRemoval,
    inside,
    laneIdentity,
    removeLane,
    sameLaneIdentity,
    parseWorktrees,
    shellPort,
    type LaneIdentity,
    type LaneRemovalPort,
    type ShellCaptureOptions,
    type ShellRunner,
    type Worktree,
} from './removeLane.ts';

export const CLEANUP_DIRECTORY = '.agents/lane-cleanup';
const LOCK_REF = 'refs/sourdaw/lane-cleanup/lock';
const MAX_ATTEMPTS_PER_RUN = 20;
const CIRCUIT_FILE = 'inspection-backoff.json';

export type CleanupRecord = {
    version: 1;
    repository: string;
    primaryRoot: string;
    identity: LaneIdentity;
    status: 'pending' | 'protected' | 'removed';
    attempts: number;
    nextAttemptAt: number;
    reason: string;
};
export type CleanupOutcome = { lane: string; status: CleanupRecord['status']; reason: string };
export type CleanupPort = {
    primaryRoot: string;
    removal: LaneRemovalPort;
    now: () => number;
    serialize: <Value>(operation: () => Value) => Value;
    log: (message: string) => void;
};

export function cleanupFailureReason(error: unknown): string {
    const message = (error instanceof Error ? error.message : String(error)).replace(/[\r\n\u2028\u2029]/g, ' ').trim();
    return unsafeCredentialReason(message) === undefined
        ? message.slice(0, 512)
        : 'inspection failed (private details withheld)';
}

export function cleanupBackoff(attempts: number): number {
    return Math.min(24 * 60 * 60_000, 5 * 60_000 * 2 ** Math.min(9, Math.max(0, attempts - 1)));
}

/** The primary may remain on an older tracked .gitignore after delivery. */
export function ensureCleanupExcluded(primaryRoot: string): void {
    const env = githubAuthorizationGitEnv();
    const git = (args: string[]) => spawnCapture('git', args, { cwd: primaryRoot, env });
    if (parseWorktrees(git(['worktree', 'list', '--porcelain', '-z']))[0]?.path !== primaryRoot) {
        throw new Error('cleanup exclusions require the protected primary checkout');
    }
    const common = realpathSync(git(['rev-parse', '--path-format=absolute', '--git-common-dir']));
    const info = join(common, 'info');
    mkdirSync(info, { recursive: true });
    if (!lstatSync(info).isDirectory() || lstatSync(info).isSymbolicLink() || realpathSync(info) !== info) {
        throw new Error('cleanup Git exclusion directory is not regular');
    }
    const path = join(info, 'exclude');
    if (existsSync(path) && (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink())) {
        throw new Error('cleanup Git exclusion file is not regular');
    }
    const previous = existsSync(path) ? readFileSync(path, 'utf8') : '';
    const entry = '/.agents/lane-cleanup/';
    if (previous.split(/\r?\n/).includes(entry)) return;
    const fd = openSync(path, 'a', 0o600);
    try {
        // One append preserves existing bytes and concurrent unrelated exclusions.
        writeFileSync(fd, `${previous === '' || previous.endsWith('\n') ? '' : '\n'}${entry}\n`);
        fsyncSync(fd);
    } finally {
        closeSync(fd);
    }
}

/** Never follow an operational-state symlink into a different checkout. */
export function cleanupDirectory(primaryRoot: string): string {
    const root = realpathSync(primaryRoot);
    ensureCleanupExcluded(root);
    for (const part of ['.agents', CLEANUP_DIRECTORY]) {
        const path = join(root, part);
        mkdirSync(path, { recursive: true, mode: 0o700 });
        const stat = lstatSync(path);
        if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(path) !== path) {
            throw new Error('cleanup state directory is not owned by this primary checkout');
        }
    }
    return join(root, CLEANUP_DIRECTORY);
}

function atomicJson(path: string, value: unknown): void {
    const temporary = `${path}.${randomUUID()}.candidate`;
    const fd = openSync(temporary, 'wx', 0o600);
    try {
        writeFileSync(fd, `${JSON.stringify(value)}\n`);
        fsyncSync(fd);
    } finally {
        closeSync(fd);
    }
    renameSync(temporary, path);
}

function recordKey(identity: LaneIdentity): string {
    return createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}

export function readCleanupRecords(primaryRoot: string): CleanupRecord[] {
    const directory = cleanupDirectory(primaryRoot);
    return readdirSync(directory)
        .filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
        .map((name) => {
            const path = join(directory, name);
            if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) {
                throw new Error('cleanup record is not a regular file');
            }
            const record = JSON.parse(readFileSync(path, 'utf8')) as CleanupRecord;
            if (
                record.version !== 1 ||
                record.repository !== REQUIRED_REPOSITORY ||
                record.primaryRoot !== primaryRoot ||
                record.identity === undefined ||
                record.identity.directory === undefined ||
                recordKey(record.identity) !== name.slice(0, -5) ||
                !Number.isSafeInteger(record.attempts) ||
                record.attempts < 0 ||
                !Number.isSafeInteger(record.nextAttemptAt) ||
                record.nextAttemptAt < 0 ||
                !['pending', 'protected', 'removed'].includes(record.status)
            ) {
                throw new Error('cleanup record identity is invalid');
            }
            return record;
        });
}

function writeRecord(directory: string, record: CleanupRecord): void {
    atomicJson(join(directory, `${recordKey(record.identity)}.json`), record);
}

/** Only exact registered roots qualify; symlink aliases do not expand automatic deletion authority. */
export function cleanupCandidate(primaryRoot: string, lane: Worktree): boolean {
    if (lane.path === primaryRoot || lane.bare || lane.prunable) {
        return false;
    }
    for (const name of ['worktrees', 'review-worktrees']) {
        const root = join(primaryRoot, '.agents', name);
        if (
            lane.path !== root &&
            inside(root, lane.path) &&
            realpathSync(lane.path) === lane.path &&
            realpathSync(root) === root &&
            !relative(root, lane.path).split('/').includes('..')
        ) {
            return (
                name === 'worktrees' ||
                (lane.detached && lane.branch === undefined && relative(root, lane.path).split('/').length === 1)
            );
        }
    }
    return false;
}

/** CAS in Git, rather than a timestamp or filesystem reaper race, serializes workers across crashes. */
export function withCleanupLock<Value>(primaryRoot: string, shell: ShellRunner, operation: () => Value): Value {
    const owner = { version: 1, pid: process.pid, token: randomUUID() };
    const oid = spawnCapture('git', ['hash-object', '-w', '--stdin'], {
        cwd: primaryRoot,
        env: githubAuthorizationGitEnv(),
        input: JSON.stringify(owner),
    });
    let previous = '';
    try {
        previous = shell.capture('git', ['rev-parse', '--verify', LOCK_REF]);
    } catch {
        // A missing ref is the only absent lock; a corrupt/unreadable repository refuses below.
        const refs = shell.capture('git', ['for-each-ref', '--format=%(objectname)', LOCK_REF]);
        if (refs !== '') {
            throw new Error('cleanup lock inspection failed');
        }
    }
    if (previous !== '') {
        const existing = JSON.parse(shell.capture('git', ['cat-file', 'blob', previous])) as {
            version?: number;
            pid?: number;
        };
        if (existing.version !== 1 || !Number.isSafeInteger(existing.pid) || (existing.pid ?? 0) <= 0) {
            throw new Error('cleanup lock owner is unknown');
        }
        try {
            process.kill(existing.pid!, 0);
            throw new Error('cleanup worker is already running');
        } catch (error) {
            if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) {
                throw error;
            }
        }
    }
    shell.run('git', ['update-ref', LOCK_REF, oid, previous || '0'.repeat(oid.length)]);
    try {
        return operation();
    } finally {
        shell.run('git', ['update-ref', '-d', LOCK_REF, oid]);
    }
}

export function cleanupLanes(port: CleanupPort, onlyHead?: string, queueOnly = false): CleanupOutcome[] {
    return port.serialize(() => {
        const primaryRoot = realpathSync(port.primaryRoot);
        const directory = cleanupDirectory(primaryRoot);
        const registered = port.removal.worktrees();
        if (registered[0]?.path !== primaryRoot) {
            throw new Error('cleanup primary does not match the live worktree registry');
        }
        assertRequiredRepository(port.removal.repository());
        const records = readCleanupRecords(primaryRoot);
        const candidates: CleanupRecord[] = [];
        const outcomes: CleanupOutcome[] = [];
        for (const lane of registered) {
            if (onlyHead !== undefined && lane.head !== onlyHead) {
                continue;
            }
            let identity: LaneIdentity;
            try {
                if (!cleanupCandidate(primaryRoot, lane)) {
                    port.log(`protected ${lane.path}: outside managed cleanup roots or no removable worktree`);
                    continue;
                }
                identity = laneIdentity(lane);
            } catch (error) {
                const reason = cleanupFailureReason(error);
                outcomes.push({ lane: lane.path, status: 'protected', reason });
                port.log(`protected ${lane.path}: ${reason}`);
                continue;
            }
            const record = records.find((item) => sameLaneIdentity(item.identity, identity));
            // A different registered directory or HEAD never inherits a stale cleanup request.
            const reused = records.some(
                (item) => item.identity.path === lane.path && !sameLaneIdentity(item.identity, identity)
            );
            const current: CleanupRecord = record ?? {
                version: 1,
                repository: REQUIRED_REPOSITORY,
                primaryRoot,
                identity,
                status: 'pending',
                attempts: 0,
                nextAttemptAt: 0,
                reason: 'awaiting live merged-head and inactivity proof',
            };
            if (onlyHead !== undefined && record !== undefined && record.status !== 'removed') {
                current.nextAttemptAt = 0;
            }
            if (reused && record === undefined) {
                current.status = 'protected';
                current.reason =
                    'registered path or HEAD replaced a previous cleanup identity; awaiting independent fresh proof';
                current.nextAttemptAt = port.now() + cleanupBackoff(1);
            }
            writeRecord(directory, current);
            candidates.push(current);
        }
        // Persist every candidate before network access or removal, including a killed first attempt.
        candidates.sort((left, right) => left.nextAttemptAt - right.nextAttemptAt);
        let attempted = 0;
        const circuitPath = join(directory, CIRCUIT_FILE);
        const circuit = existsSync(circuitPath)
            ? (JSON.parse(readFileSync(circuitPath, 'utf8')) as { nextAttemptAt: number })
            : { nextAttemptAt: 0 };
        if (!Number.isSafeInteger(circuit.nextAttemptAt)) {
            throw new Error('cleanup inspection backoff is invalid');
        }
        let unavailable = queueOnly || circuit.nextAttemptAt > port.now();
        for (const record of candidates) {
            if (!unavailable && record.nextAttemptAt <= port.now() && attempted < MAX_ATTEMPTS_PER_RUN) {
                attempted += 1;
                record.attempts += 1;
                record.status = 'pending';
                record.reason = 'cleanup attempt in progress';
                record.nextAttemptAt = port.now() + cleanupBackoff(record.attempts);
                writeRecord(directory, record);
                try {
                    removeLane(record.identity.path, port.removal, record.identity);
                    record.status = 'removed';
                    record.reason = 'native worktree removal completed after live merged-head proof';
                } catch (error) {
                    record.reason = cleanupFailureReason(error);
                    const safetyRefusal = /^(?:worktree|refusing|PR #|branch |detached review|queued worktree)/.test(
                        record.reason
                    );
                    record.status = safetyRefusal ? 'protected' : 'pending';
                    if (safetyRefusal) record.nextAttemptAt = port.now() + cleanupBackoff(1);
                    if (!safetyRefusal) {
                        unavailable = true;
                        atomicJson(circuitPath, { nextAttemptAt: record.nextAttemptAt, reason: record.reason });
                    }
                }
                writeRecord(directory, record);
            }
            const outcome = { lane: record.identity.path, status: record.status, reason: record.reason };
            outcomes.push(outcome);
            port.log(`${outcome.status} ${outcome.lane}: ${outcome.reason}`);
        }
        return outcomes;
    });
}

export async function runCleanup(primaryRoot: string, onlyHead?: string): Promise<CleanupOutcome[]> {
    const root = realpathSync(primaryRoot);
    const gitEnv = githubAuthorizationGitEnv();
    const localShell: ShellRunner = {
        capture: (command, args, options?: ShellCaptureOptions) =>
            command === 'lsof' || command === 'ps'
                ? captureRemoval(command, args, options)
                : spawnCapture(command, args, {
                      cwd: root,
                      env: command === 'git' ? gitEnv : process.env,
                      trim: options?.preserveStdout !== true,
                  }),
        run: (command, args) => spawnRun(command, args, { cwd: root, env: command === 'git' ? gitEnv : process.env }),
    };
    const remote = localShell.capture('git', ['remote', 'get-url', 'origin']);
    if (!['https://github.com/jcosta33/sourdaw.git', 'git@github.com:jcosta33/sourdaw.git'].includes(remote)) {
        throw new Error('cleanup origin is not the required repository');
    }
    const queuedRemoval = { ...shellPort(localShell, root), repository: () => REQUIRED_REPOSITORY };
    const queuedPort: CleanupPort = {
        primaryRoot: root,
        removal: queuedRemoval,
        now: Date.now,
        serialize: (operation) => withCleanupLock(root, localShell, operation),
        log: () => {},
    };
    cleanupLanes(queuedPort, onlyHead, true);
    const circuitPath = join(cleanupDirectory(root), CIRCUIT_FILE);
    if (
        existsSync(circuitPath) &&
        (JSON.parse(readFileSync(circuitPath, 'utf8')) as { nextAttemptAt: number }).nextAttemptAt > Date.now()
    ) {
        return cleanupLanes({ ...queuedPort, log: console.log }, onlyHead, true);
    }
    // Use the author App's independent, read-only quota; no shared operator REST dependency.
    let auth: Awaited<ReturnType<typeof authenticateRole>>;
    try {
        auth = await authenticateRole({
            primaryRoot: root,
            role: 'author',
            permissions: { contents: 'read', pull_requests: 'read', issues: 'read' },
        });
    } catch (error) {
        atomicJson(circuitPath, { nextAttemptAt: Date.now() + cleanupBackoff(1), reason: cleanupFailureReason(error) });
        throw error;
    }
    try {
        const shell: ShellRunner = {
            capture: (command, args, options) =>
                command === 'gh'
                    ? spawnCapture(command, args, {
                          cwd: root,
                          env: auth.session.env,
                          trim: options?.preserveStdout !== true,
                      })
                    : localShell.capture(command, args, options),
            run: localShell.run,
        };
        const removal = { ...shellPort(shell, root), repository: () => REQUIRED_REPOSITORY };
        let fetched = false;
        return cleanupLanes(
            {
                primaryRoot: root,
                removal: {
                    ...removal,
                    currentDirectory: () => root,
                    fetch: () => {
                        if (!fetched) {
                            removal.fetch();
                            fetched = true;
                        }
                    },
                },
                now: Date.now,
                serialize: (operation) => withCleanupLock(root, shell, operation),
                log: console.log,
            },
            onlyHead
        );
    } finally {
        auth.session.dispose();
    }
}

async function main(): Promise<number> {
    try {
        const args = process.argv.slice(2);
        const primaryRoot = resolvePrimaryRoot();
        if (args[0] === '--status' && args.length === 1) {
            for (const record of readCleanupRecords(primaryRoot)) {
                console.log(`${record.status} ${record.identity.path}: ${record.reason}`);
            }
            return 0;
        }
        if (args.length !== 0) {
            throw new Error('usage: pnpm lane:cleanup [--status]');
        }
        assertTrustedExecutingBlob(
            'scripts/cleanupLanes.ts',
            fileURLToPath(import.meta.url),
            originMainBlob('scripts/cleanupLanes.ts', primaryRoot)
        );
        await runCleanup(primaryRoot);
        return 0;
    } catch (error) {
        console.error(cleanupFailureReason(error));
        return 1;
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    void main().then((code) => {
        process.exitCode = code;
    });
}
