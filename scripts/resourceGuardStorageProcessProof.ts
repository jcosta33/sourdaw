import { observeProcessIdentity, type ProcessRow, type ProcessTreeHost } from './resourceGuardProcessTree.ts';
import {
    storageReferenceState,
    type StorageProcessIdentity,
    type StorageRecoveryPorts,
} from './resourceGuardStorage.ts';

export type StorageIdentityState = 'alive' | 'dead' | 'unknown' | 'replaced';

export function storageIdentityState(
    identity: StorageProcessIdentity,
    report: ((reason: string) => void) | undefined,
    host: Pick<ProcessTreeHost, 'kill' | 'processStartedAt'>
): StorageIdentityState {
    const observation = observeProcessIdentity(identity.pid, identity.startedAt, host);
    if (observation.state === 'absent') {
        return 'dead';
    }
    if (observation.state === 'reused') {
        return 'replaced';
    }
    // A readable matching start cannot turn a denied zero probe into liveness proof.
    if (observation.signalZero.state === 'unknown') {
        report?.(
            `session-identity-unknown:pid=${identity.pid}:status=probe-unavailable:errno=${observation.signalZero.errno ?? 'unknown'}`
        );
        return 'unknown';
    }
    if (observation.state === 'matching') {
        return 'alive';
    }
    report?.(`session-identity-unknown:pid=${identity.pid}:status=start-unavailable`);
    return 'unknown';
}

// A recovered owner's stored ticks remain the Linux bound. Only this same live
// supervisor may instead provide a current PID for the older-process excuse.
export function startTimeExcuseSupervisor(
    owner: StorageProcessIdentity,
    currentPid: number,
    hostPlatform: NodeJS.Platform,
    identityState: (identity: StorageProcessIdentity) => StorageIdentityState
): number | undefined {
    if (hostPlatform !== 'linux' || owner.pid !== currentPid) {
        return undefined;
    }
    return identityState(owner) === 'alive' ? currentPid : undefined;
}

export type StorageRecoveryHost = {
    platform: () => NodeJS.Platform;
    currentPid: number;
    identityState: (identity: StorageProcessIdentity, report?: (reason: string) => void) => StorageIdentityState;
    processCensus: (sessionToken: string) => { rows: ProcessRow[]; rawOutput?: string } | undefined;
    fileState: (
        tempDirectories: string[],
        ownedPids: number[],
        report: (reason: string) => void,
        supervisorPid?: number,
        ownerStartTicks?: number
    ) => 'alive' | 'dead' | 'unknown';
};

type StorageOwner = Parameters<StorageRecoveryPorts['sessionState']>[0];

function storageIdentityController(read: StorageRecoveryHost['identityState']) {
    // Engine/runtime state belongs to this proof controller, shared by its local
    // release and recovery ports. Only an exact, positively replaced binding retires.
    const retired = new Map<number, Set<string>>();
    const isReplaced = (identity: StorageProcessIdentity) =>
        retired.get(identity.pid)?.has(identity.startedAt) === true;
    return {
        isReplaced,
        observe: (identity: StorageProcessIdentity, report?: (reason: string) => void): StorageIdentityState => {
            if (isReplaced(identity)) {
                return 'replaced';
            }
            const state = read(identity, report);
            if (state === 'replaced') {
                const starts = retired.get(identity.pid) ?? new Set<string>();
                starts.add(identity.startedAt);
                retired.set(identity.pid, starts);
            }
            return state;
        },
    };
}

type IdentityController = ReturnType<typeof storageIdentityController>;

function trackedStorageIdentities(owner: StorageOwner): StorageProcessIdentity[] {
    const identities = Array.from(owner.tracked);
    if (owner.child !== undefined) {
        identities.push(owner.child);
    }
    return identities;
}

function hasOriginalChildGroup(owner: StorageOwner, rows: ProcessRow[], identities: IdentityController): boolean {
    const child = owner.child;
    if (child === undefined) {
        return false;
    }
    // Leader exit alone leaves the original group authoritative. A positive new
    // leader identity proves that the numeric group now belongs to a different run.
    const childState = identities.observe(child);
    return childState !== 'replaced' && rows.some((row) => row.processGroupId === child.pid);
}

function trackedStorageState(
    owner: StorageOwner,
    identities: IdentityController,
    report: (reason: string) => void
): 'alive' | 'unknown' | undefined {
    for (const identity of trackedStorageIdentities(owner)) {
        let reason: string | undefined;
        const state = identities.observe(identity, (value) => {
            reason = value;
        });
        if (state === 'dead' || state === 'replaced') {
            continue;
        }
        if (state === 'unknown') {
            report(reason ?? `session-identity-unknown:pid=${identity.pid}:status=unclassified`);
        }
        return state;
    }
    return undefined;
}

function storageSessionState(
    owner: StorageOwner,
    tempDirectory: string,
    currentTempDirectory: string,
    host: StorageRecoveryHost,
    identities: IdentityController,
    report: (reason: string) => void
): 'alive' | 'dead' | 'unknown' {
    if (host.platform() === 'win32' && owner.phase !== 'ready') {
        report('session-platform-unsupported');
        return 'unknown';
    }
    const census = host.processCensus(owner.token);
    if (census === undefined) {
        report('session-process-census-unavailable');
        return 'unknown';
    }
    if (host.platform() !== 'win32') {
        const references = storageReferenceState(census.rawOutput, tempDirectory);
        if (references !== 'dead') {
            if (references === 'unknown') {
                report('session-reference-unavailable');
            }
            return references;
        }
    }
    if (census.rows.some((row) => row.sessionOwned) || hasOriginalChildGroup(owner, census.rows, identities)) {
        return 'alive';
    }
    const trackedState = trackedStorageState(owner, identities, report);
    if (trackedState !== undefined) {
        return trackedState;
    }
    if (host.platform() === 'win32') {
        return 'dead';
    }
    // This read determines whether the supervisor's numeric PID is still owned;
    // it cannot add a blocking session reason or broaden the original-ticks excuse.
    const ownerState = identities.observe(owner.owner);
    const supervisorPid = startTimeExcuseSupervisor(owner.owner, host.currentPid, host.platform(), () => ownerState);
    const ownerStartTicks = host.platform() === 'linux' ? owner.owner.startTicks : undefined;
    const ownedIdentities = [owner.owner, ...trackedStorageIdentities(owner)];
    return host.fileState(
        [tempDirectory, currentTempDirectory],
        ownedIdentities.filter((identity) => !identities.isReplaced(identity)).map((identity) => identity.pid),
        report,
        supervisorPid,
        ownerStartTicks
    );
}

export function storageRecoveryPorts(
    report: (reason: string) => void,
    host: StorageRecoveryHost
): StorageRecoveryPorts {
    const identities = storageIdentityController(host.identityState);
    const ports: StorageRecoveryPorts = {
        identityState: (identity) => {
            const state = identities.observe(identity);
            // This proves only the recorded identity gone; deletion still needs session proof.
            return state === 'replaced' ? 'dead' : state;
        },
        sessionState: (owner, tempDirectory, currentTempDirectory = tempDirectory) =>
            storageSessionState(owner, tempDirectory, currentTempDirectory, host, identities, report),
        localReleaseAllowed: (owner, tempDirectory, currentTempDirectory) => {
            // Windows local cleanup retains its tracked-tree contract; crash
            // recovery still requires its own conservative session proof.
            if (host.platform() === 'win32') {
                return true;
            }
            return ports.sessionState(owner, tempDirectory, currentTempDirectory) === 'dead';
        },
    };
    return ports;
}
