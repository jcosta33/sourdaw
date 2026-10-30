import { readlinkSync } from 'node:fs';
import { resolve } from 'node:path';

import { recordOf, type RecordObservation } from './journal.ts';
import { linuxIdentity, type ProcessIdentity } from './linuxProcessIdentity.ts';
import { browserTraceBinding, type BrowserTraceBinding } from './traceBinding.ts';

import type { Browser, CDPSession } from '@playwright/test';

export { linuxIdentity, type ProcessIdentity } from './linuxProcessIdentity.ts';

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
    if (!match || !Number.isSafeInteger(Number(match[1]))) {
        throw new Error('Script request lacks renderer PID prefix');
    }
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
    if (before.start !== after.start) {
        throw new Error('Renderer PID was reused during registration');
    }
}

export function createRendererAssociations(
    owner: number,
    record: RecordObservation,
    ports: {
        identity: (pid: number, owner: number) => ProcessIdentity;
        processes: () => Promise<unknown>;
        binding: (processes: unknown) => BrowserTraceBinding;
    }
): {
    frame: (frame: Record<string, unknown>) => void;
    request: (event: Record<string, unknown>) => void;
    settle: () => Promise<number>;
} {
    const frames = new Map<string, string>();
    const seen = new Map<number, string>();
    const attempted = new Set<string>();
    const pending = new Set<Promise<void>>();
    let mapped = 0;
    let capacityReported = false;
    return {
        frame(frame) {
            if (typeof frame.id === 'string' && typeof frame.loaderId === 'string') {
                frames.set(frame.id, frame.loaderId);
            }
        },
        request(event) {
            if (event.type !== 'Script') {
                return;
            }
            let pid: number | undefined;
            let invalid: Error | undefined;
            try {
                pid = rendererPid(event);
            } catch (error) {
                if (error instanceof Error) {
                    invalid = error;
                } else {
                    invalid = new Error(String(error), { cause: error });
                }
            }
            const key = `${pid ?? 'unknown'}:${String(event.frameId)}:${String(event.loaderId)}`;
            // Claim synchronously, before proc I/O or the first CDP await. Failed
            // associations are also final so a script burst cannot retry them.
            if (attempted.has(key)) {
                return;
            }
            if (attempted.size >= 2048) {
                if (!capacityReported) {
                    record('renderer-association-capacity-unknown', { limit: 2048 });
                }
                capacityReported = true;
                return;
            }
            attempted.add(key);
            const operation = (async (): Promise<void> => {
                try {
                    if (invalid) {
                        throw invalid;
                    }
                    if (pid === undefined) {
                        throw new Error('Renderer PID unavailable');
                    }
                    if (frames.get(String(event.frameId)) !== event.loaderId) {
                        throw new Error('Script frame/loader registration missed');
                    }
                    const before = ports.identity(pid, owner);
                    const processes = await ports.processes();
                    const entries = recordOf(processes, 'process info').processInfo;
                    if (!Array.isArray(entries)) {
                        throw new Error('SystemInfo processes missing');
                    }
                    const types = new Map<number, string>();
                    for (const value of entries) {
                        const entry = recordOf(value, 'process');
                        if (typeof entry.id === 'number' && typeof entry.type === 'string') {
                            types.set(entry.id, entry.type);
                        }
                    }
                    const after = ports.identity(pid, owner);
                    assertRendererIdentity(pid, types, before, after);
                    const binding = ports.binding(processes);
                    const prior = seen.get(pid);
                    if (prior !== undefined && prior !== after.start) {
                        record('renderer-pid-reuse', { pid, priorStart: prior, currentStart: after.start });
                    }
                    seen.set(pid, after.start);
                    record('page-renderer-identity', {
                        requestId: event.requestId,
                        frameId: event.frameId,
                        loaderId: event.loaderId,
                        requestTimestamp: event.timestamp,
                        identity: after,
                        traceBinding: binding,
                        birth: 'unknown before live registration; new loader/PID associations are revalidated',
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
        },
        async settle() {
            await Promise.all(pending);
            return mapped;
        },
    };
}

export async function observeRendererIdentities(
    browser: Browser,
    session: CDPSession,
    owner: number,
    record: RecordObservation,
    traceRoot: string
): Promise<() => Promise<number>> {
    const root = await browser.newBrowserCDPSession();
    const associations = createRendererAssociations(owner, record, {
        identity: linuxIdentity,
        processes: () => root.send('SystemInfo.getProcessInfo'),
        binding: (processes) => browserTraceBinding(processes, owner, traceRoot),
    });
    const visit = (value: unknown): void => {
        const tree = recordOf(value, 'frame tree');
        associations.frame(recordOf(tree.frame, 'frame'));
        if (Array.isArray(tree.childFrames)) {
            for (const child of tree.childFrames) {
                visit(child);
            }
        }
    };
    session.on('Page.frameNavigated', (payload: unknown) =>
        associations.frame(recordOf(recordOf(payload, 'navigation').frame, 'frame'))
    );
    session.on('Network.requestWillBeSent', (payload: unknown) =>
        associations.request(recordOf(payload, 'script request'))
    );
    await session.send('Page.enable');
    visit(recordOf(await session.send('Page.getFrameTree'), 'frame response').frameTree);
    await session.send('Network.enable');
    record('renderer-registration-ready', {
        owner,
        namespace: readlinkSync('/proc/self/ns/pid'),
        traceRoot: resolve(traceRoot),
        limits: [
            'Only renderer-generated page Script IDs are interpreted; Document and worker IDs are never parsed.',
            'One live validation per PID/frame/loader association. Births before registration and unmatched native TIDs remain unknown.',
        ],
    });
    return associations.settle;
}
