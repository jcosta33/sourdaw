import { readFileSync, statfsSync } from 'node:fs';
import { resolve } from 'node:path';

function readObservation(path: string): { value: string } | { unknown: string } {
    try {
        return { value: readFileSync(path, 'utf8') };
    } catch (error) {
        return { unknown: error instanceof Error ? error.message : String(error) };
    }
}

function processSample(pid: number): Record<string, unknown> {
    const root = `/proc/${pid}`;
    return {
        pid,
        stat: readObservation(`${root}/stat`),
        status: readObservation(`${root}/status`),
        cgroup: readObservation(`${root}/cgroup`),
    };
}

function descendants(root: number): { pids: number[]; unknown: string[] } {
    const pids = new Set<number>([root]);
    const queue = [root];
    const unknown: string[] = [];
    while (queue.length > 0 && pids.size <= 1_024) {
        const pid = queue.shift();
        if (pid === undefined) {
            break;
        }
        const children = readObservation(`/proc/${pid}/task/${pid}/children`);
        if ('unknown' in children) {
            unknown.push(children.unknown);
            continue;
        }
        for (const value of children.value.trim().split(/\s+/).filter(Boolean)) {
            const child = Number(value);
            if (Number.isSafeInteger(child) && child > 0 && !pids.has(child)) {
                pids.add(child);
                queue.push(child);
            }
        }
    }
    if (queue.length > 0) {
        unknown.push('Process census exceeded1024 entries');
    }
    return { pids: [...pids], unknown };
}

function cgroupSample(pid: number): Record<string, unknown> {
    const membership = readObservation(`/proc/${pid}/cgroup`);
    if ('unknown' in membership) {
        return membership;
    }
    const row = membership.value.split('\n').find((line) => line.startsWith('0::'));
    if (row === undefined) {
        return { unknown: 'No cgroup-v2 membership observed', membership };
    }
    const directory = resolve('/sys/fs/cgroup', `.${row.slice(3)}`);
    if (directory !== '/sys/fs/cgroup' && !directory.startsWith('/sys/fs/cgroup/')) {
        return { unknown: 'Cgroup path is outside observed hierarchy', membership };
    }
    const files = [
        'memory.current',
        'memory.peak',
        'memory.max',
        'memory.events',
        'memory.events.local',
        'memory.swap.current',
        'memory.swap.max',
        'cpu.stat',
        'cpu.max',
        'cpu.pressure',
    ];
    return {
        membership,
        directory,
        files: Object.fromEntries(files.map((name) => [name, readObservation(resolve(directory, name))])),
    };
}

function diskSample(root: string): Record<string, unknown> {
    try {
        const filesystem = statfsSync(root);
        return {
            bytesAvailable: filesystem.bavail * filesystem.bsize,
            bytesFree: filesystem.bfree * filesystem.bsize,
            bytesTotal: filesystem.blocks * filesystem.bsize,
        };
    } catch (error) {
        return { unknown: error instanceof Error ? error.message : String(error) };
    }
}

export function sampleLinuxResources(
    rootPid: number,
    serverPid: number | undefined,
    sourceRoot: string
): Record<string, unknown> {
    if (process.platform !== 'linux') {
        return { unknown: 'Linux process/cgroup telemetry is unavailable on this platform' };
    }
    const census = descendants(rootPid);
    return {
        rootPid,
        censusUnknown: census.unknown,
        processes: census.pids.map(processSample),
        serverPid,
        listenerTables: { tcp: readObservation('/proc/net/tcp'), tcp6: readObservation('/proc/net/tcp6') },
        memory: readObservation('/proc/meminfo'),
        pressure: readObservation('/proc/pressure/memory'),
        cpuPressure: readObservation('/proc/pressure/cpu'),
        disk: diskSample(sourceRoot),
        cgroup: cgroupSample(serverPid ?? rootPid),
        kernelOomAttribution:
            'Unknown unless independently readable host evidence is retained; cgroup counters alone do not identify the initiating process.',
    };
}
