import { spawnSync } from 'node:child_process';

export type ProcessGroupSnapshot =
    | { status: 'unavailable' }
    | {
          status: 'available';
          rows: Array<{
              pid: number;
              parentPid: number;
              processGroupId: number;
              uid: number;
              state: string;
              start: string;
          }>;
          truncated: boolean;
      };

/** A diagnostic only: a snapshot never proves ownership or authorizes signaling. */
export function captureProcessGroupSnapshot(groupId: number): ProcessGroupSnapshot {
    if (!Number.isSafeInteger(groupId) || groupId <= 1 || process.platform === 'win32') {
        return { status: 'unavailable' };
    }
    try {
        const result = spawnSync('ps', ['-axo', 'pid=,ppid=,pgid=,uid=,stat=,lstart='], {
            encoding: 'utf8',
            timeout: 1_000,
            maxBuffer: 1024 * 1024,
            env: { PATH: process.env.PATH, LC_ALL: 'C' },
        });
        if (result.status !== 0 || result.error !== undefined) {
            return { status: 'unavailable' };
        }
        return parseProcessGroupSnapshot(result.stdout, groupId);
    } catch {
        return { status: 'unavailable' };
    }
}

export function parseProcessGroupSnapshot(output: string, groupId: number): ProcessGroupSnapshot {
    if (!Number.isSafeInteger(groupId) || groupId <= 1 || output.trim() === '') {
        return { status: 'unavailable' };
    }
    const rows: Extract<ProcessGroupSnapshot, { status: 'available' }>['rows'] = [];
    let truncated = false;
    for (const line of output.trimEnd().split('\n')) {
        const match =
            /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+([A-Za-z+<>-]{1,16})\s+([A-Za-z]{3}\s+[A-Za-z]{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s*$/u.exec(
                line
            );
        if (match === null) {
            return { status: 'unavailable' };
        }
        if (Number(match[3]) !== groupId) {
            continue;
        }
        if (rows.length === 32) {
            truncated = true;
            continue;
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
    return { status: 'available', rows, truncated };
}
