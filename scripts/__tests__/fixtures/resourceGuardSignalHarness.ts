import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { RESOURCE_ROOT_ENV, RESOURCE_SESSION_ENV } from '../../resourceGuard.ts';

type Message = { event: string; [key: string]: unknown };
type OwnedChild = { pid: number; startedAt: string; tempDirectory: string };

export function readSignalAcknowledgement(path: string): unknown {
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined;
}

function observeClose(child: ChildProcess): Promise<number | null> {
    const completion = new Promise<number | null>((resolve, reject) => {
        let spawnError: Error | undefined;
        child.once('error', (error) => {
            spawnError = error;
        });
        // Preserve spawn errors, but settle only after the terminal close observable.
        child.once('close', (code) => {
            if (spawnError !== undefined) {
                reject(spawnError);
            } else {
                resolve(code);
            }
        });
    });
    void completion.catch(() => undefined);
    return completion;
}

async function waitUntil(predicate: () => boolean, deadline: number): Promise<void> {
    while (!predicate()) {
        if (Date.now() >= deadline) {
            throw new Error('signal fixture lifecycle barrier timed out');
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
}

export function startSignalFixture(input: {
    root: string;
    stagedAcknowledgement?: 'ready' | 'first-term';
    holdAbort?: boolean;
    holdIdentity?: boolean;
}) {
    const { root } = input;
    const readyPath = join(root, 'ready.json');
    const termPath = join(root, 'first-term.json');
    const unrelatedPath = join(root, 'unrelated');
    const env: NodeJS.ProcessEnv = {
        ...process.env,
        [RESOURCE_ROOT_ENV]: root,
        SOURDAW_SIGNAL_HOLD_ABORT: input.holdAbort ? '1' : '0',
        SOURDAW_SIGNAL_HOLD_IDENTITY: input.holdIdentity ? '1' : '0',
    };
    delete env[RESOURCE_SESSION_ENV];
    const messages: Message[] = [];
    const unrelated = spawn(
        process.execPath,
        [
            '-e',
            `require('node:fs').writeFileSync(${JSON.stringify(unrelatedPath)}, 'ready'); setInterval(() => {}, 1000)`,
        ],
        { stdio: 'ignore' }
    );
    const unrelatedCompletion = observeClose(unrelated);
    const guard = spawn(
        process.execPath,
        [
            resolve('scripts/__tests__/fixtures/resourceGuardSignal.ts'),
            '--profile',
            'focused',
            '--max-rss-mib',
            '512',
            '--',
            process.execPath,
            resolve('scripts/__tests__/fixtures/resourceGuardSignalChild.ts'),
            root,
            input.stagedAcknowledgement ?? '',
        ],
        { cwd: root, env, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] }
    );
    let guardClosed = false;
    let guardStderr = '';
    guard.once('close', () => {
        guardClosed = true;
    });
    const completion = observeClose(guard);
    guard.on('message', (message: Message) => messages.push(message));
    guard.stderr?.on('data', (chunk: Buffer) => {
        guardStderr = `${guardStderr}${chunk.toString()}`.slice(-8_192);
    });
    const hasEvent = (event: string) => messages.some((message) => message.event === event);
    const child = (): OwnedChild | undefined => {
        const identity = messages.find((message) => message.event === 'owned-child');
        if (
            identity === undefined ||
            typeof identity.pid !== 'number' ||
            !Number.isSafeInteger(identity.pid) ||
            identity.pid <= 0 ||
            typeof identity.startedAt !== 'string' ||
            identity.startedAt.length === 0 ||
            typeof identity.tempDirectory !== 'string'
        ) {
            return undefined;
        }
        return { pid: identity.pid, startedAt: identity.startedAt, tempDirectory: identity.tempDirectory };
    };
    const deadline = Date.now() + 15_000;
    const barrier = async (predicate: () => boolean) => {
        try {
            await waitUntil(() => {
                if (predicate()) {
                    return true;
                }
                if (guardClosed) {
                    throw new Error('guard closed before the lifecycle barrier');
                }
                return false;
            }, deadline);
        } catch (error) {
            throw new Error(
                `${error instanceof Error ? error.message : String(error)}; guard exit=${guard.exitCode}; stderr=${guardStderr}; events=${JSON.stringify(messages)}`,
                { cause: error }
            );
        }
    };
    const send = (message: string) => guard.send(message);
    const cleanup = async () => {
        let diagnostic: string | undefined;
        try {
            if (!guardClosed && guard.connected) {
                send('abort');
                await waitUntil(() => guardClosed || hasEvent('abort-held'), Date.now() + 10_000);
            }
            if (guardClosed) {
                await completion;
            }
        } catch (error) {
            diagnostic = error instanceof Error ? error.message : String(error);
        } finally {
            unrelated.kill('SIGKILL');
            try {
                await unrelatedCompletion;
            } catch (error) {
                diagnostic = `unrelated child failed after close: ${error instanceof Error ? error.message : String(error)}`;
            }
        }
        const identity = child();
        const childExitProved =
            identity !== undefined &&
            messages.some(
                (message) =>
                    message.event === 'storage-released' &&
                    message.removed === true &&
                    message.treeStopped === true &&
                    message.pid === identity.pid &&
                    message.startedAt === identity.startedAt
            );
        const removedRoot = guardClosed && childExitProved;
        if (removedRoot) {
            rmSync(root, { recursive: true, force: true });
        } else {
            diagnostic = `signal fixture retained at ${root}: owned child exit or storage removal unproved${diagnostic === undefined ? '' : `; ${diagnostic}`}`;
        }
        return { removedRoot, childExitProved, diagnostic };
    };
    return {
        root,
        readyPath,
        termPath,
        unrelatedPath,
        guard,
        unrelated,
        completion,
        messages,
        child,
        hasEvent,
        barrier,
        send,
        cleanup,
        isClosed: () => guardClosed,
    };
}
