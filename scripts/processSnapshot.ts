import { spawnSync } from 'node:child_process';

type ProcessRow = {
    pid: number;
    parentPid: number;
    processGroupId: number;
    uid: number;
    state: string;
    start: string;
};

export type ProcessGroupSnapshot =
    { status: 'unavailable' } | { status: 'available'; rows: ProcessRow[]; truncated: boolean };

function processCensus(): string | undefined {
    if (process.platform === 'win32') {
        return undefined;
    }
    try {
        const result = spawnSync('ps', ['-axo', 'pid=,ppid=,pgid=,uid=,stat=,lstart='], {
            encoding: 'utf8',
            timeout: 1_000,
            maxBuffer: 1024 * 1024,
            env: { PATH: process.env.PATH, LC_ALL: 'C' },
        });
        return result.status === 0 && result.error === undefined ? result.stdout : undefined;
    } catch {
        return undefined;
    }
}

function parseCensus(output: string): ProcessRow[] | undefined {
    if (output.trim() === '') {
        return undefined;
    }
    const rows: ProcessRow[] = [];
    for (const line of output.trimEnd().split('\n')) {
        const match =
            /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+([A-Za-z+<>-]{1,16})\s+([A-Za-z]{3}\s+[A-Za-z]{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s*$/u.exec(
                line
            );
        if (match === null) {
            return undefined;
        }
        rows.push({
            pid: Number(match[1]),
            parentPid: Number(match[2]),
            processGroupId: Number(match[3]),
            uid: Number(match[4]),
            state: match[5]!,
            start: match[6]!,
        });
    }
    return rows;
}

function groupSnapshot(rows: ProcessRow[], groupId: number): ProcessGroupSnapshot {
    const group = rows.filter((row) => row.processGroupId === groupId);
    return { status: 'available', rows: group.slice(0, 32), truncated: group.length > 32 };
}

/** A diagnostic only: a snapshot never proves ownership or authorizes signaling. */
export function captureProcessGroupSnapshot(groupId: number): ProcessGroupSnapshot {
    if (!Number.isSafeInteger(groupId) || groupId <= 1) {
        return { status: 'unavailable' };
    }
    const output = processCensus();
    return output === undefined ? { status: 'unavailable' } : parseProcessGroupSnapshot(output, groupId);
}

export function parseProcessGroupSnapshot(output: string, groupId: number): ProcessGroupSnapshot {
    if (!Number.isSafeInteger(groupId) || groupId <= 1) {
        return { status: 'unavailable' };
    }
    const rows = parseCensus(output);
    return rows === undefined ? { status: 'unavailable' } : groupSnapshot(rows, groupId);
}

/** Capture the group containing this process in one bounded census, without inferring ownership. */
export function captureProcessGroupOfPid(pid: number): ProcessGroupSnapshot {
    if (!Number.isSafeInteger(pid) || pid <= 1) {
        return { status: 'unavailable' };
    }
    const output = processCensus();
    const rows = output === undefined ? undefined : parseCensus(output);
    const processRow = rows?.find((row) => row.pid === pid);
    if (rows === undefined || processRow === undefined || processRow.processGroupId <= 1) {
        return { status: 'unavailable' };
    }
    const peers = rows.filter((row) => row.pid !== pid && row.processGroupId === processRow.processGroupId);
    return { status: 'available', rows: [processRow, ...peers.slice(0, 31)], truncated: peers.length > 31 };
}
