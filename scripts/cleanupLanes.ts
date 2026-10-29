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
    rmSync,
    writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { unsafeCredentialReason } from './evidenceSafety.ts';
import {
    assertRequiredRepository,
    assertTrustedExecutingBlob,
    authenticateRole,
    CLEANUP_MINT_PERMISSIONS,
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
import { guardFailureReceiptPath, readGuardFailureReceipt } from './prContract.ts';
import { clearGuardFailureReceiptIfUnchanged } from './resourceGuard.ts';

export const CLEANUP_DIRECTORY = '.agents/lane-cleanup';
const LOCK_REF = 'refs/sourdaw/lane-cleanup/lock';
const MAX_ATTEMPTS_PER_RUN = 20;
const CIRCUIT_FILE = 'inspection-backoff.json';

type GuardReceiptFingerprint = { hash: string; dev: number; ino: number; birthtimeMs: number };

export type CleanupRecord = {
    version: 1;
    repository: string;
    primaryRoot: string;
    identity: LaneIdentity;
    status: 'pending' | 'protected' | 'removed';
    attempts: number;
    nextAttemptAt: number;
    reason: string;
    removal?: { guardFailure: GuardReceiptFingerprint | null };
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
    const message = (error instanceof Error ? error.message : String(error))
        .replaceAll(/[\r\n\u2028\u2029]/g, ' ')
        .trim();
    if (unsafeCredentialReason(message) !== undefined) {
        return 'inspection failed (private details withheld)';
    }
    return message.slice(0, 512);
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
    if (previous.split(/\r?\n/).includes(entry)) {
        return;
    }
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
                !validRemovalCheckpoint(record.removal) ||
                !['pending', 'protected', 'removed'].includes(record.status)
            ) {
                throw new Error('cleanup record identity is invalid');
            }
            return record;
        });
}

function validRemovalCheckpoint(removal: CleanupRecord['removal']): boolean {
    if (removal === undefined || removal?.guardFailure === null) {
        return true;
    }
    const fingerprint = removal?.guardFailure;
    return (
        fingerprint !== undefined &&
        typeof fingerprint === 'object' &&
        /^[a-f0-9]{64}$/.test(fingerprint.hash) &&
        [fingerprint.dev, fingerprint.ino, fingerprint.birthtimeMs].every(
            (value) => Number.isFinite(value) && value >= 0
        )
    );
}

function writeRecord(directory: string, record: CleanupRecord): void {
    atomicJson(join(directory, `${recordKey(record.identity)}.json`), record);
}

function guardReceiptFingerprint(path: string): GuardReceiptFingerprint | null {
    try {
        const parent = dirname(path);
        if (!lstatSync(parent).isDirectory() || realpathSync(parent) !== parent) {
            throw new Error('guard receipt parent is not canonical');
        }
        const stat = lstatSync(path);
        if (!stat.isFile() || stat.isSymbolicLink()) {
            throw new Error('guard receipt is not a regular file');
        }
        const hash = createHash('sha256').update(readFileSync(path)).digest('hex');
        const after = lstatSync(path);
        if (stat.dev !== after.dev || stat.ino !== after.ino || stat.birthtimeMs !== after.birthtimeMs) {
            throw new Error('guard receipt changed during inspection');
        }
        return { hash, dev: stat.dev, ino: stat.ino, birthtimeMs: stat.birthtimeMs };
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}

function ownedGuardReceipt(primaryRoot: string, identity: LaneIdentity): GuardReceiptFingerprint | null {
    const laneName = basename(identity.path);
    const fingerprint = guardReceiptFingerprint(guardFailureReceiptPath(primaryRoot, laneName));
    if (fingerprint === null) {
        return null;
    }
    const receipt = readGuardFailureReceipt(primaryRoot, laneName);
    if (
        receipt?.headSha !== identity.head ||
        (identity.branch !== undefined && receipt.branch !== identity.branch) ||
        (receipt.cwd !== undefined && receipt.cwd !== identity.path)
    ) {
        return null;
    }
    return fingerprint;
}

function removedWorktreeAbsent(record: CleanupRecord, port: CleanupPort): boolean {
    const path = record.identity.path;
    const roots = ['worktrees', 'review-worktrees'].map((name) => join(record.primaryRoot, '.agents', name));
    if (!roots.some((root) => path !== root && inside(root, path)) || realpathSync(dirname(path)) !== dirname(path)) {
        throw new Error('queued worktree removal path is not canonical within managed roots');
    }
    if (port.removal.worktrees().some((lane) => lane.path === path)) {
        return false;
    }
    try {
        lstatSync(path);
        return false;
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            return true;
        }
        throw error;
    }
}

function finishRemovedWorktree(record: CleanupRecord, port: CleanupPort): string {
    if (!removedWorktreeAbsent(record, port)) {
        delete record.removal;
        throw new Error('queued worktree removal path was reused; preserving its bookkeeping');
    }
    const completed = 'worktree absent from filesystem and registry; removal bookkeeping completed';
    const expected = record.removal?.guardFailure;
    const laneName = basename(record.identity.path);
    const path = guardFailureReceiptPath(record.primaryRoot, laneName);
    if (expected === undefined || expected === null) {
        return 'worktree absent from filesystem and registry; unbound guard bookkeeping preserved';
    }
    const current = guardReceiptFingerprint(path);
    if (current === null) {
        return completed;
    }
    if (JSON.stringify(current) !== JSON.stringify(expected)) {
        return 'worktree absent from filesystem and registry; newer guard bookkeeping preserved';
    }
    const receipt = readGuardFailureReceipt(record.primaryRoot, laneName);
    if (receipt === undefined) {
        return completed;
    }
    const result = clearGuardFailureReceiptIfUnchanged(record.primaryRoot, laneName, receipt, {
        rmSync: (claimed, options) => {
            // The native receipt helper claims atomically; recheck file identity and bytes on that
            // claim too, so a concurrent replacement never spends this old cleanup authority.
            if (
                typeof claimed !== 'string' ||
                !removedWorktreeAbsent(record, port) ||
                JSON.stringify(guardReceiptFingerprint(claimed)) !== JSON.stringify(expected)
            ) {
                throw new Error('guard bookkeeping changed during removal cleanup');
            }
            rmSync(claimed, options);
        },
    });
    if (result.status === 'error') {
        throw new Error(result.message);
    }
    return result.status === 'mismatch' ? 'worktree absent; changed guard bookkeeping preserved' : completed;
}

function attemptCleanupRemoval(record: CleanupRecord, port: CleanupPort, directory: string): void {
    const registered = port.removal.worktrees().some((lane) => lane.path === record.identity.path);
    if (registered) {
        removeLane(
            record.identity.path,
            {
                ...port.removal,
                remove: (path) => {
                    // This boundary is reached only after removeLane's live proof and final safety checks.
                    record.removal = { guardFailure: ownedGuardReceipt(record.primaryRoot, record.identity) };
                    writeRecord(directory, record);
                    port.removal.remove(path);
                },
                clearGuardFailure: () => {
                    finishRemovedWorktree(record, port);
                },
            },
            record.identity
        );
    }
    record.reason = finishRemovedWorktree(record, port);
    record.status = 'removed';
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

function queueCleanupCandidates(
    port: CleanupPort,
    primaryRoot: string,
    directory: string,
    registered: Worktree[],
    records: CleanupRecord[],
    onlyHead?: string
): { candidates: CleanupRecord[]; outcomes: CleanupOutcome[] } {
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
    return { candidates, outcomes };
}

function queueUnregisteredRecords(
    records: CleanupRecord[],
    registered: Worktree[],
    candidates: CleanupRecord[],
    outcomes: CleanupOutcome[],
    directory: string,
    onlyHead?: string
): void {
    for (const record of records) {
        if (
            record.status === 'removed' ||
            (onlyHead !== undefined && record.identity.head !== onlyHead) ||
            candidates.some((current) => sameLaneIdentity(current.identity, record.identity))
        ) {
            continue;
        }
        if (registered.some((lane) => lane.path === record.identity.path)) {
            // Seeing a replacement permanently retires the old receipt authority, even if that
            // replacement later disappears before another scan.
            delete record.removal;
            record.status = 'protected';
            record.reason = 'queued worktree identity was replaced; old bookkeeping authority retired';
            writeRecord(directory, record);
            outcomes.push({ lane: record.identity.path, status: record.status, reason: record.reason });
            continue;
        }
        candidates.push(record);
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
        const { candidates, outcomes } = queueCleanupCandidates(
            port,
            primaryRoot,
            directory,
            registered,
            records,
            onlyHead
        );
        const replaced: CleanupOutcome[] = [];
        queueUnregisteredRecords(records, registered, candidates, replaced, directory, onlyHead);
        // Persist every candidate before network access or removal, including a killed first attempt.
        candidates.sort((left, right) => left.nextAttemptAt - right.nextAttemptAt);
        let attempted = 0;
        const circuitPath = join(directory, CIRCUIT_FILE);
        let circuit = { nextAttemptAt: 0 };
        if (existsSync(circuitPath)) {
            circuit = JSON.parse(readFileSync(circuitPath, 'utf8')) as { nextAttemptAt: number };
        }
        if (!Number.isSafeInteger(circuit.nextAttemptAt)) {
            throw new TypeError('cleanup inspection backoff is invalid');
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
                    attemptCleanupRemoval(record, port, directory);
                } catch (error) {
                    record.reason = cleanupFailureReason(error);
                    const safetyRefusal = /^(?:worktree|refusing|PR #|branch |detached review|queued worktree)/.test(
                        record.reason
                    );
                    record.status = safetyRefusal ? 'protected' : 'pending';
                    if (safetyRefusal) {
                        record.nextAttemptAt = port.now() + cleanupBackoff(1);
                    }
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
        return [...outcomes, ...replaced];
    });
}

export function authenticateCleanup(primaryRoot: string, authenticate: typeof authenticateRole = authenticateRole) {
    return authenticate({ primaryRoot, role: 'author', permissions: CLEANUP_MINT_PERMISSIONS });
}

export async function runCleanup(primaryRoot: string, onlyHead?: string): Promise<CleanupOutcome[]> {
    const root = realpathSync(primaryRoot);
    const gitEnv = githubAuthorizationGitEnv();
    const localShell: ShellRunner = {
        capture: (command, args, options?: ShellCaptureOptions) => {
            if (command === 'lsof' || command === 'ps') {
                return captureRemoval(command, args, options);
            }
            return spawnCapture(command, args, {
                cwd: root,
                env: command === 'git' ? gitEnv : process.env,
                trim: options?.preserveStdout !== true,
            });
        },
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
        auth = await authenticateCleanup(root);
    } catch (error) {
        atomicJson(circuitPath, { nextAttemptAt: Date.now() + cleanupBackoff(1), reason: cleanupFailureReason(error) });
        throw error;
    }
    try {
        const shell: ShellRunner = {
            capture: (command, args, options) => {
                if (command === 'gh') {
                    return spawnCapture(command, args, {
                        cwd: root,
                        env: auth.session.env,
                        trim: options?.preserveStdout !== true,
                    });
                }
                return localShell.capture(command, args, options);
            },
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
        if (args.length > 0) {
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
