import { readFileSync, readlinkSync } from 'node:fs';

import { recordOf, type RecordObservation } from './journal.ts';

import type { Browser, CDPSession } from '@playwright/test';

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

export function rendererPid(event: Record<string, unknown>): number {
    if (
        event.type !== 'Script' ||
        typeof event.frameId !== 'string' ||
        !event.frameId ||
        typeof event.loaderId !== 'string' ||
        !event.loaderId
    ) {
        throw new Error('Renderer identity requires a page Script with actual frame/loader');
    }
    const match = typeof event.requestId === 'string' ? /^([1-9][0-9]*)\.[0-9]+$/.exec(event.requestId) : null;
    if (!match || !Number.isSafeInteger(Number(match[1]))) throw new Error('Script request lacks renderer PID prefix');
    return Number(match[1]);
}

export function assertRendererIdentity(
    pid: number,
    types: ReadonlyMap<number, string>,
    before: ProcessIdentity,
    after: ProcessIdentity
): void {
    if (types.get(pid) !== 'renderer' || before.pid !== pid || after.pid !== pid || !before.owned || !after.owned) {
        throw new Error('Script PID is not a live owned SystemInfo renderer');
    }
    if (
        before.namespace !== before.observerNamespace ||
        after.namespace !== after.observerNamespace ||
        before.namespace !== after.namespace
    ) {
        throw new Error('Script PID namespace differs from observer namespace');
    }
    if (before.start !== after.start) throw new Error('Renderer PID was reused during registration');
}

export async function observeRendererIdentities(
    browser: Browser,
    session: CDPSession,
    owner: number,
    record: RecordObservation
): Promise<() => Promise<number>> {
    const root = await browser.newBrowserCDPSession();
    const frames = new Map<string, string>();
    const seen = new Map<number, string>();
    const pending = new Set<Promise<void>>();
    let mapped = 0;
    const visit = (value: unknown): void => {
        const tree = recordOf(value, 'frame tree');
        const frame = recordOf(tree.frame, 'frame');
        if (typeof frame.id === 'string' && typeof frame.loaderId === 'string') frames.set(frame.id, frame.loaderId);
        if (Array.isArray(tree.childFrames)) for (const child of tree.childFrames) visit(child);
    };
    session.on('Page.frameNavigated', (payload: unknown) => {
        const frame = recordOf(recordOf(payload, 'navigation').frame, 'frame');
        if (typeof frame.id === 'string' && typeof frame.loaderId === 'string') frames.set(frame.id, frame.loaderId);
    });
    session.on('Network.requestWillBeSent', (payload: unknown) => {
        const event = recordOf(payload, 'script request');
        if (event.type !== 'Script') return;
        const operation = (async (): Promise<void> => {
            try {
                const pid = rendererPid(event);
                if (frames.get(String(event.frameId)) !== event.loaderId)
                    throw new Error('Script frame/loader registration missed');
                const before = linuxIdentity(pid, owner);
                const processes = recordOf(await root.send('SystemInfo.getProcessInfo'), 'process info');
                if (!Array.isArray(processes.processInfo)) throw new Error('SystemInfo processes missing');
                const types = new Map<number, string>();
                for (const value of processes.processInfo) {
                    const entry = recordOf(value, 'process');
                    if (typeof entry.id === 'number' && typeof entry.type === 'string') types.set(entry.id, entry.type);
                }
                const after = linuxIdentity(pid, owner);
                assertRendererIdentity(pid, types, before, after);
                const prior = seen.get(pid);
                if (prior !== undefined && prior !== after.start)
                    record('renderer-pid-reuse', { pid, priorStart: prior, currentStart: after.start });
                seen.set(pid, after.start);
                record('page-renderer-identity', {
                    requestId: event.requestId,
                    frameId: event.frameId,
                    loaderId: event.loaderId,
                    requestTimestamp: event.timestamp,
                    identity: after,
                    birth:
                        prior === undefined
                            ? 'first-observed; birth-before-registration-unknown'
                            : 'previously-observed',
                });
                mapped++;
            } catch (error) {
                record('page-renderer-identity-unknown', {
                    requestId: event.requestId,
                    frameId: event.frameId,
                    loaderId: event.loaderId,
                    reason: String(error),
                });
            }
        })();
        pending.add(operation);
        void operation.finally(() => pending.delete(operation));
    });
    await session.send('Page.enable');
    visit(recordOf(await session.send('Page.getFrameTree'), 'frame response').frameTree);
    await session.send('Network.enable');
    record('renderer-registration-ready', {
        owner,
        namespace: readlinkSync('/proc/self/ns/pid'),
        limits: [
            'Only renderer-generated page Script IDs are interpreted; Document and worker IDs are never parsed.',
            'Births/exits before registration and unmatched native thread IDs remain unknown.',
        ],
    });
    return async () => {
        await Promise.all(pending);
        return mapped;
    };
}
