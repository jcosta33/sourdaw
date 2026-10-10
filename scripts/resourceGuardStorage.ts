import { randomUUID } from 'node:crypto';
import {
    closeSync,
    constants,
    fstatSync,
    lstatSync,
    mkdirSync,
    openSync,
    readFileSync,
    readdirSync,
    realpathSync,
    renameSync,
    rmSync,
    rmdirSync,
    unlinkSync,
    statfsSync,
    writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { resolvePrimaryRoot } from './githubAppIdentity.ts';

export const DEFAULT_DISK_RESERVE_BYTES = 20 * 1024 ** 3;
export const DISK_RESERVE_ENV = 'SOURDAW_GUARD_DISK_RESERVE_MIB';

export type StorageProcessIdentity = { pid: number; startedAt: string };
type StorageOwner = {
    version: 1;
    token: string;
    directoryIdentity: string;
    owner: StorageProcessIdentity;
    phase: 'ready' | 'spawning' | 'running';
    child?: StorageProcessIdentity;
    tracked: StorageProcessIdentity[];
};

export type StorageRecoveryPorts = {
    identityState: (identity: StorageProcessIdentity) => 'alive' | 'dead' | 'unknown';
    sessionState: (
        owner: StorageOwner,
        tempDirectory: string,
        currentTempDirectory?: string
    ) => 'alive' | 'dead' | 'unknown';
    localReleaseAllowed?: (owner: StorageOwner, tempDirectory: string, currentTempDirectory?: string) => boolean;
};

export function storageReferenceState(
    processOutput: string | undefined,
    tempDirectory: string
): 'alive' | 'dead' | 'unknown' {
    if (processOutput === undefined || processOutput.trim() === '') {
        return 'unknown';
    }
    // Command/environment output can contain continuation lines without a PID header.
    // A reference vetoes deletion but conveys no process identity or signal authority.
    return processOutput.includes(tempDirectory) ? 'alive' : 'dead';
}

export function sameUserProcessIds(
    output: string,
    uid: number,
    supervisorPid: number,
    ownedPids: number[]
): number[] | undefined {
    const users = new Map<number, number>();
    for (const line of output.trim().split('\n')) {
        const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
        if (match === null) {
            return undefined;
        }
        const pid = Number(match[1]);
        const user = Number(match[2]);
        if (!Number.isSafeInteger(pid) || pid <= 0 || !Number.isSafeInteger(user) || users.has(pid)) {
            return undefined;
        }
        users.set(pid, user);
    }
    if (users.get(supervisorPid) !== uid || ownedPids.some((pid) => users.has(pid) && users.get(pid) !== uid)) {
        return undefined;
    }
    const pids: number[] = [];
    for (const [pid, user] of users) {
        if (user === uid) {
            pids.push(pid);
        }
    }
    return pids;
}

function parseLsofFile(
    fields: string[],
    knownTypes: Set<string>,
    report: (reason: string) => void
): { path?: string; missingType: boolean } | undefined {
    const unavailable = (reason: string) => {
        report(reason);
        return undefined;
    };
    if (!/^f(?:\d+|cwd|twd|txt|mem|rtd|pd)$/.test(fields[0] ?? '')) {
        return unavailable('invalid-descriptor');
    }
    const type = fields.find((field) => field.startsWith('t'))?.slice(1);
    const name = fields.find((field) => field.startsWith('n'))?.slice(1);
    if (type !== undefined && !knownTypes.has(type)) {
        return unavailable('unknown-file-type');
    }
    if (
        fields.some((field) => !/^[ftn]/.test(field)) ||
        new Set(fields.map((field) => field[0])).size !== fields.length
    ) {
        return unavailable('invalid-file-fields');
    }
    if (name !== undefined && /Permission denied|Operation not permitted|no info|\((?:stat|readlink):/i.test(name)) {
        return unavailable('file-inspection-diagnostic');
    }
    if (type === undefined && (fields.length !== 2 || name === undefined || name === '')) {
        return unavailable('invalid-file-fields');
    }
    if (type === 'REG' || type === 'DIR') {
        if (name === undefined || !name.startsWith('/')) {
            return unavailable('missing-file-path');
        }
        return { path: name, missingType: false };
    }
    return { missingType: type === undefined };
}

export function parseLsofCensus(
    output: string,
    report: (reason: string) => void = () => {}
): { pids: Set<number>; paths: string[] } | undefined {
    const unavailable = (reason: string) => {
        report(reason);
        return undefined;
    };
    if (!output.endsWith('\0\n')) {
        return unavailable('truncated-record');
    }
    const pids = new Set<number>();
    const paths: string[] = [];
    let fileCount = 0;
    let missingType = false;
    const knownTypes = new Set([
        'REG',
        'DIR',
        'CHR',
        'BLK',
        'FIFO',
        'IPv4',
        'IPv6',
        'unix',
        'PIPE',
        'KQUEUE',
        'NPOLICY',
        'systm',
        'NEXUS',
        'CHAN',
        'PSXSEM',
        'PSXSHM',
    ]);
    for (const set of output.slice(0, -2).split('\0\n')) {
        const fields = set.split('\0');
        const first = fields[0] ?? '';
        if (first.startsWith('p')) {
            if (pids.size > 0 && fileCount === 0) {
                return unavailable('process-without-files');
            }
            const pid = Number(first.slice(1));
            if (!/^p[1-9]\d*$/.test(first) || !Number.isSafeInteger(pid) || fields.length !== 1 || pids.has(pid)) {
                return unavailable('invalid-process-record');
            }
            pids.add(pid);
            fileCount = 0;
            continue;
        }
        if (pids.size === 0) {
            return unavailable('invalid-descriptor');
        }
        const file = parseLsofFile(fields, knownTypes, report);
        if (file === undefined) {
            return undefined;
        }
        missingType ||= file.missingType;
        if (file.path !== undefined) {
            paths.push(file.path);
        }
        fileCount += 1;
    }
    if (fileCount === 0) {
        return unavailable('process-without-files');
    }
    return missingType ? unavailable('descriptor-type-missing') : { pids, paths };
}

export function referencesStoragePath(path: string, tempDirectories: string[]): boolean {
    const original = path.endsWith(' (deleted)') ? path.slice(0, -10) : path;
    return tempDirectories.some(
        (tempDirectory) => original === tempDirectory || original.startsWith(`${tempDirectory}/`)
    );
}

const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseIdentity(value: unknown): StorageProcessIdentity | undefined {
    if (
        !isRecord(value) ||
        typeof value.pid !== 'number' ||
        !Number.isInteger(value.pid) ||
        value.pid <= 0 ||
        value.pid > 2 ** 31 - 1 ||
        typeof value.startedAt !== 'string' ||
        value.startedAt.trim() !== value.startedAt ||
        value.startedAt.length === 0 ||
        value.startedAt.length > 200
    ) {
        return undefined;
    }
    return { pid: value.pid, startedAt: value.startedAt };
}

function parseOwner(value: unknown, token: string): StorageOwner | undefined {
    if (
        !isRecord(value) ||
        value.version !== 1 ||
        value.token !== token ||
        typeof value.directoryIdentity !== 'string' ||
        !/^\d+:\d+$/.test(value.directoryIdentity) ||
        (value.phase !== 'ready' && value.phase !== 'spawning' && value.phase !== 'running') ||
        !Array.isArray(value.tracked) ||
        value.tracked.length > 8192
    ) {
        return undefined;
    }
    const owner = parseIdentity(value.owner);
    const child = value.child === undefined ? undefined : parseIdentity(value.child);
    const tracked = value.tracked.map(parseIdentity);
    if (
        owner === undefined ||
        (value.child !== undefined && child === undefined) ||
        (value.phase === 'running' && child === undefined) ||
        tracked.some((identity) => identity === undefined)
    ) {
        return undefined;
    }
    const parsed: StorageOwner = {
        version: 1,
        token,
        directoryIdentity: value.directoryIdentity,
        owner,
        phase: value.phase,
        tracked: tracked.filter((identity): identity is StorageProcessIdentity => identity !== undefined),
    };
    if (child !== undefined) {
        parsed.child = child;
    }
    return parsed;
}

function directoryIdentity(path: string): string {
    const metadata = lstatSync(path, { bigint: true });
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
        throw new Error(`guard storage must be a real directory: ${path}`);
    }
    return `${metadata.dev}:${metadata.ino}`;
}

function ensureStorageRoot(root: string): void {
    // Validate every existing component before mkdir; recursive creation must never follow a link.
    let ancestor = resolve(root);
    const missing: string[] = [];
    while (true) {
        try {
            directoryIdentity(ancestor);
            break;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                throw error;
            }
            missing.push(ancestor);
            ancestor = dirname(ancestor);
        }
    }
    while (ancestor !== dirname(ancestor)) {
        ancestor = dirname(ancestor);
        directoryIdentity(ancestor);
    }
    for (const path of missing.reverse()) {
        try {
            mkdirSync(path, { mode: 0o700 });
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
                throw error;
            }
        }
        directoryIdentity(path);
    }
}

export function resolveGuardStorageRoot(cwd: string): string {
    let primary: string;
    try {
        primary = resolvePrimaryRoot(undefined, cwd);
    } catch (error) {
        if (!(error instanceof Error) || !error.message.includes('not a git repository')) {
            throw error;
        }
        primary = realpathSync(cwd);
    }
    return join(primary, '.agents', 'guard-storage');
}

function readStorageOwner(path: string, token: string): StorageOwner | undefined {
    const identity = directoryIdentity(path);
    directoryIdentity(join(path, 'tmp'));
    const ownerMetadata = lstatSync(join(path, 'owner.json'));
    if (!ownerMetadata.isFile() || ownerMetadata.isSymbolicLink()) {
        return undefined;
    }
    const fd = openSync(join(path, 'owner.json'), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
        const metadata = fstatSync(fd);
        if (!metadata.isFile() || metadata.size > 1024 ** 2) {
            return undefined;
        }
        const owner = parseOwner(JSON.parse(readFileSync(fd, 'utf8')), token);
        return owner?.directoryIdentity === identity ? owner : undefined;
    } finally {
        closeSync(fd);
    }
}

function writeStorageOwner(path: string, owner: StorageOwner): void {
    if (directoryIdentity(path) !== owner.directoryIdentity) {
        throw new Error('guard storage ownership changed');
    }
    const candidate = join(path, `owner-${randomUUID()}.candidate`);
    writeFileSync(candidate, `${JSON.stringify(owner)}\n`, { flag: 'wx', mode: 0o600 });
    renameSync(candidate, join(path, 'owner.json'));
}

type StorageClaim = {
    version: 1;
    token: string;
    directoryIdentity: string;
    reclaimer: StorageProcessIdentity;
    run: StorageOwner;
};

function readClaim(path: string, token: string): StorageClaim | undefined {
    const identity = directoryIdentity(path);
    const claimMetadata = lstatSync(join(path, 'claim.json'));
    if (!claimMetadata.isFile() || claimMetadata.isSymbolicLink()) {
        return undefined;
    }
    const fd = openSync(join(path, 'claim.json'), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
        const metadata = fstatSync(fd);
        if (!metadata.isFile() || metadata.size > 1024 ** 2) {
            return undefined;
        }
        const value: unknown = JSON.parse(readFileSync(fd, 'utf8'));
        if (!isRecord(value) || value.version !== 1 || value.token !== token || value.directoryIdentity !== identity) {
            return undefined;
        }
        const reclaimer = parseIdentity(value.reclaimer);
        let run: StorageOwner | undefined;
        if (isRecord(value.run) && typeof value.run.token === 'string' && uuidPattern.test(value.run.token)) {
            run = parseOwner(value.run, value.run.token);
        }
        if (
            reclaimer === undefined ||
            run === undefined ||
            readdirSync(path).some((name) => name !== 'claim.json' && name !== run.token)
        ) {
            return undefined;
        }
        return { version: 1, token, directoryIdentity: identity, reclaimer, run };
    } finally {
        closeSync(fd);
    }
}

function removeEmptyClaim(path: string, claim: StorageClaim): void {
    const current = readClaim(path, claim.token);
    if (JSON.stringify(current) !== JSON.stringify(claim) || readdirSync(path).some((name) => name !== 'claim.json')) {
        return;
    }
    unlinkSync(join(path, 'claim.json'));
    rmdirSync(path);
}

// An atomic payload rename serializes competing scavengers. The wrapper publishes its live
// owner before that rename; after SIGKILL another start can claim its payload under a new owner.
export function reclaimGuardStorage(input: {
    root: string;
    owner: StorageOwner;
    reclaimer: StorageProcessIdentity;
    canRemove: (payloadPath: string) => boolean;
    sourceClaim?: StorageClaim;
}): boolean {
    const owner = parseOwner(input.owner, input.owner.token);
    if (!uuidPattern.test(input.owner.token) || owner === undefined || parseIdentity(input.reclaimer) === undefined) {
        throw new Error('guard storage reclamation requires valid ownership identities');
    }
    const claimsRoot = join(input.root, '.claims');
    ensureStorageRoot(claimsRoot);
    let source = join(input.root, owner.token);
    if (input.sourceClaim !== undefined) {
        source = join(claimsRoot, input.sourceClaim.token, owner.token);
    }
    if (!input.canRemove(source)) {
        return false;
    }
    if (input.sourceClaim === undefined) {
        if (JSON.stringify(readStorageOwner(source, owner.token)) !== JSON.stringify(owner)) {
            return false;
        }
    } else {
        try {
            if (directoryIdentity(source) !== owner.directoryIdentity) {
                return false;
            }
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                return true;
            }
            throw error;
        }
    }
    const token = randomUUID();
    const path = join(claimsRoot, token);
    mkdirSync(path, { mode: 0o700 });
    const claim: StorageClaim = {
        version: 1,
        token,
        directoryIdentity: directoryIdentity(path),
        reclaimer: input.reclaimer,
        run: owner,
    };
    writeFileSync(join(path, 'claim.json'), `${JSON.stringify(claim)}\n`, { flag: 'wx', mode: 0o600 });
    const payload = join(path, owner.token);
    try {
        renameSync(source, payload);
    } catch (error) {
        removeEmptyClaim(path, claim);
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return true;
        }
        throw error;
    }
    if (
        directoryIdentity(payload) !== owner.directoryIdentity ||
        JSON.stringify(readClaim(path, token)) !== JSON.stringify(claim) ||
        !input.canRemove(payload)
    ) {
        return false;
    }
    // Keep claim.json outside the recursively deleted payload until deletion has completed.
    rmSync(payload, { recursive: true });
    removeEmptyClaim(path, claim);
    return true;
}

export function recoverGuardStorage(
    root: string,
    ports: StorageRecoveryPorts,
    reclaimer: StorageProcessIdentity
): void {
    ensureStorageRoot(root);
    const isDead = (owner: StorageOwner, currentTempDirectory = join(root, owner.token, 'tmp')) =>
        ports.identityState(owner.owner) === 'dead' &&
        ports.sessionState(owner, join(root, owner.token, 'tmp'), currentTempDirectory) === 'dead';
    for (const token of readdirSync(root)) {
        if (!uuidPattern.test(token)) {
            continue;
        }
        try {
            const owner = readStorageOwner(join(root, token), token);
            if (owner !== undefined && isDead(owner)) {
                reclaimGuardStorage({
                    root,
                    owner,
                    reclaimer,
                    canRemove: (payload) => isDead(owner, join(payload, 'tmp')),
                });
            }
        } catch {
            // Malformed records, unavailable census, raced paths, and symlinks grant no deletion.
        }
    }
    const claimsRoot = join(root, '.claims');
    ensureStorageRoot(claimsRoot);
    for (const token of readdirSync(claimsRoot)) {
        if (!uuidPattern.test(token)) {
            continue;
        }
        try {
            const path = join(claimsRoot, token);
            const claim = readClaim(path, token);
            if (
                claim === undefined ||
                ports.identityState(claim.reclaimer) !== 'dead' ||
                !isDead(claim.run, join(path, claim.run.token, 'tmp'))
            ) {
                continue;
            }
            const removed = reclaimGuardStorage({
                root,
                owner: claim.run,
                reclaimer,
                sourceClaim: claim,
                canRemove: (payload) =>
                    JSON.stringify(readClaim(path, token)) === JSON.stringify(claim) &&
                    ports.identityState(claim.reclaimer) === 'dead' &&
                    isDead(claim.run, join(payload, 'tmp')),
            });
            if (removed) {
                removeEmptyClaim(path, claim);
            }
        } catch {
            // An uncertain claim remains owned evidence for a future conservative recovery.
        }
    }
}

export function createGuardStorage(input: {
    root: string;
    token: string;
    owner: StorageProcessIdentity;
    ports: StorageRecoveryPorts;
}): {
    tempDirectory: string;
    markSpawning: () => void;
    recordProcesses: (child: StorageProcessIdentity | undefined, tracked: Map<number, string>) => void;
    release: (treeStopped: boolean) => Promise<boolean>;
} {
    if (!uuidPattern.test(input.token) || parseIdentity(input.owner) === undefined) {
        throw new Error('guard storage requires a valid token and supervisor identity');
    }
    recoverGuardStorage(input.root, input.ports, input.owner);
    const path = join(input.root, input.token);
    mkdirSync(path, { mode: 0o700 });
    const tempDirectory = join(path, 'tmp');
    mkdirSync(tempDirectory, { mode: 0o700 });
    let owner: StorageOwner = {
        version: 1,
        token: input.token,
        directoryIdentity: directoryIdentity(path),
        owner: input.owner,
        phase: 'ready',
        tracked: [],
    };
    writeStorageOwner(path, owner);
    const localReleaseAllowed = (payload: string) => {
        if (input.ports.localReleaseAllowed !== undefined) {
            return input.ports.localReleaseAllowed(owner, tempDirectory, join(payload, 'tmp'));
        }
        return input.ports.sessionState(owner, tempDirectory, join(payload, 'tmp')) === 'dead';
    };
    return {
        tempDirectory,
        markSpawning: () => {
            owner = { ...owner, phase: 'spawning' };
            writeStorageOwner(path, owner);
        },
        recordProcesses: (child, tracked) => {
            const nextOwner: StorageOwner = {
                ...owner,
                tracked: Array.from(tracked, ([pid, startedAt]) => ({ pid, startedAt })),
            };
            if (child !== undefined) {
                nextOwner.child = child;
                nextOwner.phase = 'running';
            }
            owner = nextOwner;
            writeStorageOwner(path, owner);
        },
        release: async (treeStopped) => {
            if (!treeStopped) {
                return false;
            }
            return reclaimGuardStorage({
                root: input.root,
                owner,
                reclaimer: input.owner,
                canRemove: (payload) => treeStopped && localReleaseAllowed(payload),
            });
        },
    };
}

export function availableDiskBytes(path: string): number | undefined {
    try {
        const stats = statfsSync(path, { bigint: true });
        const bytes = Number(stats.bavail * stats.bsize);
        return Number.isFinite(bytes) && bytes >= 0 ? bytes : undefined;
    } catch {
        return undefined;
    }
}

export function diskStorageFailure(
    paths: readonly string[],
    reserveBytes: number,
    sampler: (path: string) => number | undefined = availableDiskBytes
): { reason: 'monitor' | 'pressure'; message: string } | undefined {
    for (const path of new Set(paths)) {
        let available: number | undefined;
        try {
            available = sampler(path);
        } catch {
            available = undefined;
        }
        if (available === undefined || !Number.isFinite(available) || available < 0) {
            return { reason: 'monitor', message: `available disk space could not be measured: ${path}` };
        }
        if (available < reserveBytes) {
            return {
                reason: 'pressure',
                message: `available disk space below ${Math.ceil(reserveBytes / 1024 ** 2)} MiB reserve: ${path} (${Math.floor(available / 1024 ** 2)} MiB available)`,
            };
        }
    }
    return undefined;
}
