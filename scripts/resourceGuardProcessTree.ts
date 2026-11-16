export type ProcessRow = {
    pid: number;
    parentPid: number;
    processGroupId: number;
    rssBytes: number;
    sessionOwned: boolean;
    command: string;
};

export type ProcessTreeSnapshot = {
    childPid?: number;
    childStartedAt?: string;
    trackedProcesses?: Array<{ pid: number; startedAt: string }>;
    invalidatedProcesses?: Array<{ pid: number; startedAt: string }>;
    pendingProcesses?: Array<{ pid: number; startedAt: string; replacementStartedAt?: string }>;
};

export type ProcessTreeHost = {
    platform: () => NodeJS.Platform;
    processTable: (sessionToken?: string) => ProcessRow[] | undefined;
    processStartedAt: (pid: number) => string | undefined;
    kill: typeof process.kill;
    terminateWindowsTree: (pid: number) => void;
};

// Engine/runtime state owned by one guarded command. Retired identity facts outlive
// an unreadable probe; only fresh independent ownership may bind a new identity.
export type ProcessTreeState = {
    identities: Map<number, string>;
    invalidated: Map<number, Set<string>>;
    pending: Map<number, { startedAt: string; replacementStartedAt?: string }>;
};

export function createProcessTreeState(
    identities = new Map<number, string>(),
    snapshot: Pick<ProcessTreeSnapshot, 'pendingProcesses' | 'childPid' | 'childStartedAt'> & {
        invalidatedProcesses?: Array<{ pid: number; startedAt?: string }>;
    } = {}
): ProcessTreeState {
    const tree: ProcessTreeState = { identities, invalidated: new Map(), pending: new Map() };
    for (const identity of snapshot.invalidatedProcesses ?? []) {
        const matchesBound = identities.get(identity.pid) === identity.startedAt;
        const matchesOriginalChild =
            snapshot.childPid === identity.pid && snapshot.childStartedAt === identity.startedAt;
        if (identity.startedAt !== undefined && (matchesBound || matchesOriginalChild)) {
            invalidateProcessIdentity(tree, identity.pid, identity.startedAt);
        }
    }
    for (const pending of snapshot.pendingProcesses ?? []) {
        if (identities.get(pending.pid) === pending.startedAt && processIdentityInvalidated(tree, pending.pid)) {
            tree.pending.set(pending.pid, {
                startedAt: pending.startedAt,
                replacementStartedAt: pending.replacementStartedAt,
            });
        }
    }
    return tree;
}

function invalidateProcessIdentity(tree: ProcessTreeState, pid: number, startedAt: string): void {
    const invalidated = tree.invalidated.get(pid) ?? new Set<string>();
    invalidated.add(startedAt);
    tree.invalidated.set(pid, invalidated);
}

function recordProcessReplacement(
    tree: ProcessTreeState,
    pid: number,
    startedAt: string,
    replacementStartedAt: string
) {
    invalidateProcessIdentity(tree, pid, startedAt);
    tree.pending.set(pid, { startedAt, replacementStartedAt });
}

function processIdentityInvalidated(tree: ProcessTreeState, pid: number): boolean {
    const startedAt = tree.identities.get(pid);
    return startedAt !== undefined && tree.invalidated.get(pid)?.has(startedAt) === true;
}

export function sampleProcessTree(
    rootPid: number,
    tree: ProcessTreeState,
    sessionToken: string,
    host: ProcessTreeHost
): number | undefined {
    const rows = host.processTable(sessionToken);
    if (rows === undefined) {
        return undefined;
    }
    return sampleProcessRows(rootPid, tree, rows, sessionToken, host).rssBytes;
}

function readTrackedStarts(
    tracked: Map<number, string>,
    rows: ProcessRow[],
    host: ProcessTreeHost
): Map<number, string | undefined> {
    const relevantPids = new Set(rows.flatMap((row) => [row.pid, row.parentPid]));
    const starts = new Map<number, string | undefined>();
    for (const pid of tracked.keys()) {
        if (relevantPids.has(pid)) {
            starts.set(pid, host.processStartedAt(pid));
        }
    }
    return starts;
}

function changedTrackedStarts(tracked: Map<number, string>, starts: Map<number, string | undefined>) {
    const changed = new Map<number, string>();
    for (const [pid, startedAt] of starts) {
        if (startedAt !== undefined && startedAt !== tracked.get(pid)) {
            changed.set(pid, startedAt);
        }
    }
    return changed;
}

function selectProcessRows(rows: ProcessRow[], seeds: number[], blocked: Set<number>): Set<number> {
    const selected = new Set<number>([
        ...seeds.filter((pid) => !blocked.has(pid)),
        ...rows.filter((row) => row.sessionOwned && !blocked.has(row.pid)).map((row) => row.pid),
    ]);
    let changed = true;
    while (changed) {
        changed = false;
        for (const row of rows) {
            if (!selected.has(row.pid) && !blocked.has(row.pid) && selected.has(row.parentPid)) {
                selected.add(row.pid);
                changed = true;
            }
        }
    }
    return selected;
}

type ProcessTreeSample = {
    rssBytes: number | undefined;
    selected: Set<number>;
    rows: ProcessRow[];
    replaced: Set<number>;
    uncertain: Set<number>;
    censusAvailable: boolean;
};

function observeProcessReplacements(tree: ProcessTreeState, rows: ProcessRow[], host: ProcessTreeHost) {
    const tracked = tree.identities;
    const replacements = changedTrackedStarts(tracked, readTrackedStarts(tracked, rows, host));
    for (const [pid, pending] of tree.pending) {
        if (tracked.get(pid) === pending.startedAt) {
            const currentStart = host.processStartedAt(pid);
            if (currentStart !== undefined && currentStart !== pending.startedAt) {
                replacements.set(pid, currentStart);
            } else if (currentStart === undefined && probeProcess(pid, host).state === 'absent') {
                tree.pending.delete(pid);
            }
        } else {
            tree.pending.delete(pid);
        }
    }
    for (const [pid, replacementStartedAt] of replacements) {
        const startedAt = tracked.get(pid);
        if (startedAt !== undefined) {
            recordProcessReplacement(tree, pid, startedAt, replacementStartedAt);
        }
    }
    return replacements;
}

function recheckOwnershipAnchors(
    tree: ProcessTreeState,
    freshStarts: Map<number, string | undefined>,
    replaced: Set<number>,
    verified: Map<number, string>,
    uncertain: Set<number>,
    host: ProcessTreeHost
) {
    const tracked = tree.identities;
    const anchors = new Set<number>();
    const authorityBlocked = new Set<number>();
    for (const [pid, startedAt] of freshStarts) {
        if (startedAt === undefined || (replaced.has(pid) && !verified.has(pid))) {
            authorityBlocked.add(pid);
        }
        if (startedAt !== undefined && startedAt === tracked.get(pid)) {
            // Check the parent anchors after candidate checks, which may themselves
            // observe a parent replacement. Unknown anchors cannot grant readmission.
            const currentStart = host.processStartedAt(pid);
            if (currentStart === startedAt) {
                anchors.add(pid);
            } else {
                authorityBlocked.add(pid);
                uncertain.add(pid);
                if (currentStart !== undefined) {
                    replaced.add(pid);
                    recordProcessReplacement(tree, pid, startedAt, currentStart);
                }
            }
        }
    }
    return { anchors, authorityBlocked };
}

function readmitFreshReplacements(
    rootPid: number,
    tree: ProcessTreeState,
    freshRows: ProcessRow[],
    replacements: Map<number, string>,
    replaced: Set<number>,
    uncertain: Set<number>,
    admitted: Map<number, string>,
    host: ProcessTreeHost
): void {
    const tracked = tree.identities;
    const freshStarts = readTrackedStarts(tracked, freshRows, host);
    for (const pid of replacements.keys()) {
        if (!freshStarts.has(pid)) {
            freshStarts.set(pid, host.processStartedAt(pid));
        }
    }
    for (const pid of changedTrackedStarts(tracked, freshStarts).keys()) {
        replaced.add(pid);
        const startedAt = tracked.get(pid);
        const replacementStartedAt = freshStarts.get(pid);
        if (startedAt !== undefined && replacementStartedAt !== undefined) {
            recordProcessReplacement(tree, pid, startedAt, replacementStartedAt);
        }
        if (!replacements.has(pid)) {
            uncertain.add(pid);
        }
    }
    const verified = new Map<number, string>();
    for (const [pid, startedAt] of replacements) {
        if (freshStarts.get(pid) === startedAt && host.processStartedAt(pid) === startedAt) {
            verified.set(pid, startedAt);
        } else {
            uncertain.add(pid);
        }
    }
    const { anchors, authorityBlocked } = recheckOwnershipAnchors(
        tree,
        freshStarts,
        replaced,
        verified,
        uncertain,
        host
    );
    const seeds = [rootPid, ...tracked.keys()].filter((pid) => !replaced.has(pid));
    const potential = selectProcessRows(freshRows, seeds, new Set());
    const authority = selectProcessRows(freshRows, [...anchors], authorityBlocked);
    for (const [pid, startedAt] of replacements) {
        if (verified.has(pid) && !uncertain.has(pid) && authority.has(pid)) {
            admitted.set(pid, startedAt);
        } else if (potential.has(pid)) {
            uncertain.add(pid);
        }
        if (!uncertain.has(pid)) {
            tree.pending.delete(pid);
        }
    }
}

function sampleProcessRows(
    rootPid: number,
    tree: ProcessTreeState,
    rows: ProcessRow[],
    sessionToken: string,
    host: ProcessTreeHost
): ProcessTreeSample {
    const tracked = tree.identities;
    const replacements = observeProcessReplacements(tree, rows, host);
    const replaced = new Set(Array.from(tracked.keys()).filter((pid) => processIdentityInvalidated(tree, pid)));
    const possible = selectProcessRows(
        rows,
        [rootPid, ...tracked.keys()].filter((pid) => !replaced.has(pid)),
        new Set()
    );
    for (const pid of replaced) {
        const startedAt = tracked.get(pid);
        if (startedAt !== undefined && !replacements.has(pid) && possible.has(pid)) {
            tree.pending.set(pid, { startedAt, replacementStartedAt: tree.pending.get(pid)?.replacementStartedAt });
        }
    }
    const uncertain = new Set<number>();
    const admitted = new Map<number, string>();
    let currentRows = rows;
    let censusAvailable = true;
    if (replacements.size > 0) {
        // A replacement may have changed after the first census. Its new identity needs
        // independent ownership observed afterwards; this remains a best-effort OS proof.
        const freshRows = host.processTable(sessionToken);
        if (freshRows === undefined) {
            censusAvailable = false;
            for (const pid of replaced) {
                uncertain.add(pid);
            }
        } else {
            currentRows = freshRows;
            readmitFreshReplacements(rootPid, tree, freshRows, replacements, replaced, uncertain, admitted, host);
        }
    }
    for (const pid of tree.pending.keys()) {
        uncertain.add(pid);
    }
    const blocked = new Set(Array.from(replaced).filter((pid) => !admitted.has(pid)));
    const seeds = [rootPid, ...tracked.keys()].filter((pid) => !replaced.has(pid));
    const selected = selectProcessRows(currentRows, seeds, blocked);
    let rssBytes = 0;
    for (const row of currentRows) {
        if (!selected.has(row.pid)) {
            continue;
        }
        rssBytes += row.rssBytes;
        const replacementStart = admitted.get(row.pid);
        if (replacementStart !== undefined) {
            tracked.set(row.pid, replacementStart);
        } else if (!tracked.has(row.pid)) {
            const startedAt = host.processStartedAt(row.pid);
            if (startedAt !== undefined) {
                tracked.set(row.pid, startedAt);
            }
        }
    }
    return {
        rssBytes: uncertain.size === 0 ? rssBytes : undefined,
        selected,
        rows: currentRows,
        replaced,
        uncertain,
        censusAvailable,
    };
}

function processIdentityReplaced(pid: number, tracked: Map<number, string>, host: ProcessTreeHost): boolean {
    const storedStart = tracked.get(pid);
    if (storedStart === undefined) {
        return false;
    }
    const currentStart = host.processStartedAt(pid);
    return currentStart !== undefined && currentStart !== storedStart;
}

export function isSameProcess(pid: number, startedAt: string | undefined, host: ProcessTreeHost): boolean {
    const observation = observeProcessIdentity(pid, startedAt, host);
    return observation.state !== 'absent' && observation.state !== 'reused';
}

type ProcessProbe = { state: 'present' | 'absent' | 'unknown'; errno?: string };

type ProcessIdentityObservation = {
    pid: number;
    storedStartedAt: string | undefined;
    currentStartedAt: string | undefined;
    state: 'matching' | 'reused' | 'absent' | 'unknown';
    signalZero: ProcessProbe;
};

export function processSignalErrno(error: unknown): string {
    if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') {
        return /^[A-Z0-9_]{1,32}$/.test(error.code) ? error.code : 'unknown';
    }
    return 'unknown';
}

function probeProcess(pid: number, host: Pick<ProcessTreeHost, 'kill'>): ProcessProbe {
    try {
        host.kill(pid, 0);
        return { state: 'present' };
    } catch (error) {
        const errno = processSignalErrno(error);
        return { state: errno === 'ESRCH' ? 'absent' : 'unknown', errno };
    }
}

export function observeProcessIdentity(
    pid: number,
    storedStartedAt: string | undefined,
    host: Pick<ProcessTreeHost, 'kill' | 'processStartedAt'>
): ProcessIdentityObservation {
    const signalZero = probeProcess(pid, host);
    const currentStartedAt = signalZero.state === 'absent' ? undefined : host.processStartedAt(pid);
    let state: ProcessIdentityObservation['state'] = 'unknown';
    if (signalZero.state === 'absent') {
        state = 'absent';
    } else if (storedStartedAt !== undefined && currentStartedAt !== undefined) {
        state = storedStartedAt === currentStartedAt ? 'matching' : 'reused';
    }
    return { pid, storedStartedAt, currentStartedAt, state, signalZero };
}

export function terminateProcessTree(
    pid: number,
    signal: NodeJS.Signals,
    tree: ProcessTreeState,
    sessionToken: string,
    host: ProcessTreeHost
): void {
    const tracked = tree.identities;
    const rows = host.processTable(sessionToken);
    const sampled = rows === undefined ? undefined : sampleProcessRows(pid, tree, rows, sessionToken, host);
    const rootReplaced = tree.invalidated.has(pid) || processIdentityReplaced(pid, tracked, host);
    if (host.platform() === 'win32' && !rootReplaced) {
        host.terminateWindowsTree(pid);
        return;
    }
    if (host.platform() !== 'win32' && !rootReplaced) {
        try {
            host.kill(-pid, signal);
        } catch {
            // The process may exit between the last sample and the signal.
        }
    }
    for (const [trackedPid, startedAt] of [...tracked.entries()].reverse()) {
        if (sampled?.uncertain.has(trackedPid) || processIdentityInvalidated(tree, trackedPid)) {
            continue;
        }
        if (host.processStartedAt(trackedPid) !== startedAt) {
            continue;
        }
        try {
            host.kill(trackedPid, signal);
        } catch {
            // The process may exit between identity verification and the signal.
        }
    }
}

function trackedProcessAlive(
    tree: ProcessTreeState,
    host: ProcessTreeHost,
    processGroupProbe: ProcessTreeObservation['processGroupProbe'],
    report?: (observation: ProcessTreeObservation) => void
): boolean {
    const tracked = tree.identities;
    for (const [trackedPid, startedAt] of tracked) {
        if (processIdentityInvalidated(tree, trackedPid)) {
            continue;
        }
        const blockingTracked = observeProcessIdentity(trackedPid, startedAt, host);
        if (blockingTracked.state === 'reused' && blockingTracked.currentStartedAt !== undefined) {
            recordProcessReplacement(tree, trackedPid, startedAt, blockingTracked.currentStartedAt);
            report?.({ census: 'available', processGroupProbe, blockedBy: 'ownership', ownedPid: trackedPid });
            return true;
        }
        if (blockingTracked.state !== 'absent' && blockingTracked.state !== 'reused') {
            report?.({ census: 'available', processGroupProbe, blockedBy: 'tracked-process', blockingTracked });
            return true;
        }
    }
    return false;
}

export function processTreeAlive(
    pid: number,
    tree: ProcessTreeState,
    sessionToken: string,
    host: ProcessTreeHost,
    report?: (observation: ProcessTreeObservation) => void
): boolean {
    const tracked = tree.identities;
    const rows = host.processTable(sessionToken);
    if (rows === undefined) {
        report?.({ census: 'unavailable', processGroupProbe: { state: 'unobserved' }, blockedBy: 'census' });
        return true;
    }
    const sampled = sampleProcessRows(pid, tree, rows, sessionToken, host);
    const uncertainPid = sampled.uncertain.values().next().value;
    if (uncertainPid !== undefined) {
        report?.({
            census: sampled.censusAvailable ? 'available' : 'unavailable',
            processGroupProbe: { state: 'unobserved' },
            blockedBy: 'ownership',
            ownedPid: uncertainPid,
            blockingTracked: observeProcessIdentity(uncertainPid, tracked.get(uncertainPid), host),
        });
        return true;
    }
    let processGroupProbe: ProcessTreeObservation['processGroupProbe'] = { state: 'unsupported' };
    // POSIX reserves a process ID while the group with that ID exists. Only positive
    // leader replacement proves the original group ended; a missing leader does not.
    if (host.platform() !== 'win32' && !tree.invalidated.has(pid) && !processIdentityReplaced(pid, tracked, host)) {
        processGroupProbe = probeProcess(-pid, host);
        if (processGroupProbe.state !== 'absent') {
            report?.({ census: 'available', processGroupProbe, blockedBy: 'process-group' });
            return true;
        }
    } else if (host.platform() !== 'win32') {
        processGroupProbe = { state: 'reused-root' };
    }
    const sessionProcess = sampled.rows.find((row) => row.sessionOwned && sampled.selected.has(row.pid));
    if (sessionProcess !== undefined) {
        report?.({
            census: 'available',
            processGroupProbe,
            blockedBy: 'session-token',
            sessionPid: sessionProcess.pid,
        });
        return true;
    }
    const untrackedProcess = sampled.rows.find((row) => sampled.selected.has(row.pid) && !tracked.has(row.pid));
    if (untrackedProcess !== undefined) {
        report?.({
            census: 'available',
            processGroupProbe,
            blockedBy: 'owned-process',
            ownedPid: untrackedProcess.pid,
        });
        return true;
    }
    if (trackedProcessAlive(tree, host, processGroupProbe, report)) {
        return true;
    }
    report?.({ census: 'available', processGroupProbe, blockedBy: 'none' });
    return false;
}

export type ProcessTreeObservation = {
    census: 'available' | 'unavailable';
    processGroupProbe: ProcessProbe | { state: 'unobserved' | 'unsupported' | 'reused-root' };
    blockedBy:
        'census' | 'process-group' | 'session-token' | 'owned-process' | 'tracked-process' | 'ownership' | 'none';
    sessionPid?: number;
    ownedPid?: number;
    blockingTracked?: ProcessIdentityObservation;
};

export function boundedProcessTreeObservation(observation: ProcessTreeObservation | undefined) {
    if (observation?.blockingTracked === undefined) {
        return observation;
    }
    return {
        ...observation,
        blockingTracked: {
            ...observation.blockingTracked,
            storedStartedAt: observation.blockingTracked.storedStartedAt?.slice(0, 64),
            currentStartedAt: observation.blockingTracked.currentStartedAt?.slice(0, 64),
        },
    };
}

export async function waitForProcessTreeExit(
    pid: number,
    tree: ProcessTreeState,
    sessionToken: string,
    timeoutMs: number,
    host: ProcessTreeHost,
    report?: (observation: ProcessTreeObservation) => void
): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (processTreeAlive(pid, tree, sessionToken, host) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return !processTreeAlive(pid, tree, sessionToken, host, report);
}
