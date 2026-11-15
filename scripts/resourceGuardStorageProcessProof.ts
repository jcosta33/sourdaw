import { processSignalErrno, type ProcessRow, type ProcessTreeHost } from './resourceGuardProcessTree.ts';
import {
    storageReferenceState,
    type StorageProcessIdentity,
    type StorageRecoveryPorts,
} from './resourceGuardStorage.ts';

export function storageIdentityState(
    identity: StorageProcessIdentity,
    report: ((reason: string) => void) | undefined,
    host: Pick<ProcessTreeHost, 'kill' | 'processStartedAt'>
): 'alive' | 'dead' | 'unknown' {
    try {
        host.kill(identity.pid, 0);
    } catch (error) {
        const errno = processSignalErrno(error);
        if (errno === 'ESRCH') {
            return 'dead';
        }
        report?.(`session-identity-unknown:pid=${identity.pid}:status=probe-unavailable:errno=${errno}`);
        return 'unknown';
    }
    const startedAt = host.processStartedAt(identity.pid);
    // A reused PID is conservatively retained; it is never authority to delete storage.
    if (startedAt !== identity.startedAt) {
        report?.(
            `session-identity-unknown:pid=${identity.pid}:status=${startedAt === undefined ? 'start-unavailable' : 'reused'}`
        );
    }
    return startedAt === identity.startedAt ? 'alive' : 'unknown';
}

// Only this run's own live supervisor can be read live to bound which processes predate it.
// Any other owner, recovered or reused, bounds the excuse only by the start ticks its storage
// record carries from creation (owner.startTicks), and by nothing when it carries none.
export function startTimeExcuseSupervisor(
    owner: StorageProcessIdentity,
    currentPid: number,
    hostPlatform: NodeJS.Platform,
    identityState: (identity: StorageProcessIdentity) => 'alive' | 'dead' | 'unknown'
): number | undefined {
    if (hostPlatform !== 'linux' || owner.pid !== currentPid) {
        return undefined;
    }
    return identityState(owner) === 'alive' ? currentPid : undefined;
}

export type StorageRecoveryHost = {
    platform: () => NodeJS.Platform;
    currentPid: number;
    identityState: (
        identity: StorageProcessIdentity,
        report?: (reason: string) => void
    ) => 'alive' | 'dead' | 'unknown';
    processCensus: (sessionToken: string) => { rows: ProcessRow[]; rawOutput?: string } | undefined;
    fileState: (
        tempDirectories: string[],
        ownedPids: number[],
        report: (reason: string) => void,
        supervisorPid?: number,
        ownerStartTicks?: number
    ) => 'alive' | 'dead' | 'unknown';
};

export function storageRecoveryPorts(
    report: (reason: string) => void,
    host: StorageRecoveryHost
): StorageRecoveryPorts {
    const ports: StorageRecoveryPorts = {
        identityState: host.identityState,
        sessionState: (owner, tempDirectory, currentTempDirectory = tempDirectory) => {
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
            if (
                census.rows.some(
                    (row) => row.sessionOwned || (owner.child !== undefined && row.processGroupId === owner.child.pid)
                )
            ) {
                return 'alive';
            }
            for (const identity of [...owner.tracked, ...(owner.child === undefined ? [] : [owner.child])]) {
                let identityReason: string | undefined;
                const state = host.identityState(identity, (reason) => {
                    identityReason = reason;
                });
                if (state !== 'dead') {
                    if (state === 'unknown') {
                        report(identityReason ?? `session-identity-unknown:pid=${identity.pid}:status=unclassified`);
                    }
                    return state;
                }
            }
            if (host.platform() === 'win32') {
                return 'dead';
            }
            const supervisorPid = startTimeExcuseSupervisor(
                owner.owner,
                host.currentPid,
                host.platform(),
                host.identityState
            );
            const ownerStartTicks = host.platform() === 'linux' ? owner.owner.startTicks : undefined;
            return host.fileState(
                [tempDirectory, currentTempDirectory],
                [
                    owner.owner.pid,
                    ...owner.tracked.map((identity) => identity.pid),
                    ...(owner.child === undefined ? [] : [owner.child.pid]),
                ],
                report,
                supervisorPid,
                ownerStartTicks
            );
        },
        localReleaseAllowed: (owner, tempDirectory, currentTempDirectory) => {
            // Windows normal cleanup keeps its tracked-tree contract. Its unavailable
            // environment census remains unknown for crash recovery, never reported dead.
            if (host.platform() === 'win32') {
                return true;
            }
            return ports.sessionState(owner, tempDirectory, currentTempDirectory) === 'dead';
        },
    };
    return ports;
}
