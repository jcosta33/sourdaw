import { readFileSync, readlinkSync } from 'node:fs';

export type ProcessIdentity = {
    pid: number;
    parent: number;
    start: string;
    namespace: string;
    observerNamespace: string;
    owned: boolean;
};

function stat(pid: number): { parent: number; start: string } {
    const text = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = text.slice(text.lastIndexOf(')') + 2).split(' ');
    const parent = Number(fields[1]);
    const start = fields[19];
    if (!Number.isSafeInteger(parent) || !start || !/^\d+$/.test(start)) throw new Error('Invalid proc start identity');
    return { parent, start };
}

export function linuxIdentity(pid: number, owner: number): ProcessIdentity {
    const first = stat(pid);
    const visited = new Set<number>();
    let ancestor = pid;
    while (ancestor > 1 && ancestor !== owner && !visited.has(ancestor) && visited.size < 1024) {
        visited.add(ancestor);
        ancestor = stat(ancestor).parent;
    }
    const namespace = readlinkSync(`/proc/${pid}/ns/pid`);
    const observerNamespace = readlinkSync('/proc/self/ns/pid');
    if (stat(pid).start !== first.start) throw new Error('PID reused during proc observation');
    return { pid, ...first, namespace, observerNamespace, owned: ancestor === owner };
}
