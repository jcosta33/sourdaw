import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { afterEach, test } from 'vitest';
import { fileURLToPath } from 'node:url';

import WebSocket, { type RawData } from 'ws';

type ServerMessage = {
    type: string;
    isHost?: boolean;
    message?: string;
    newHostId?: string | null;
};

const processes = new Set<ChildProcessWithoutNullStreams>();
const sockets = new Set<WebSocket>();
const stderrByProcess = new Map<ChildProcessWithoutNullStreams, string>();
const AUTH_TOKEN = 'test-collaboration-token-32-bytes';
const serverDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function getFreePort(): Promise<number> {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert(address && typeof address === 'object');
    const { port } = address;
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    return port;
}

function spawnServer(env: NodeJS.ProcessEnv): ChildProcessWithoutNullStreams {
    const clockImport =
        env.COLLAB_TEST_FORWARD_CLOCK === '1'
            ? [
                  '--import',
                  'data:text/javascript,const original=Date.now;const started=performance.now();Date.now=()=>original()+(performance.now()-started>=100?60000:0)',
              ]
            : [];
    const process = spawn(globalThis.process.execPath, [...clockImport, '--import', 'tsx', 'collab-server.ts'], {
        cwd: serverDirectory,
        env: {
            ...globalThis.process.env,
            COLLAB_AUTH_TOKEN: AUTH_TOKEN,
            COLLAB_HEARTBEAT_MS: '40',
            COLLAB_MAX_BUFFERED_BYTES: '4096',
            COLLAB_MAX_CONNECTIONS: '20',
            COLLAB_MAX_PAYLOAD_BYTES: '1024',
            COLLAB_MAX_PEERS_PER_SESSION: '10',
            COLLAB_MAX_SESSIONS: '10',
            COLLAB_MAX_SOURCE_CONNECTIONS: '20',
            COLLAB_RATE_LIMIT_BYTES_PER_SECOND: '4096',
            COLLAB_RATE_LIMIT_PER_SECOND: '20',
            ...env,
        },
        stdio: 'pipe',
    });
    processes.add(process);
    stderrByProcess.set(process, '');
    process.stderr.on('data', (chunk: Buffer) => {
        stderrByProcess.set(process, `${stderrByProcess.get(process) ?? ''}${chunk.toString()}`);
    });
    return process;
}

async function startServer(
    env: NodeJS.ProcessEnv = {}
): Promise<{ process: ChildProcessWithoutNullStreams; url: string; port: number }> {
    const port = await getFreePort();
    const process = spawnServer({ PORT: String(port), ...env });

    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('server did not start')), 2_000);
        process.stdout.on('data', (chunk: Buffer) => {
            if (chunk.toString().includes('Collaboration Server running')) {
                clearTimeout(timer);
                resolve();
            }
        });
        process.once('exit', (code) => reject(new Error(`server exited before startup (${String(code)})`)));
    });

    return { process, url: `ws://127.0.0.1:${port}`, port };
}

async function connect(url: string, options?: { autoPong: boolean }): Promise<WebSocket> {
    const socket = new WebSocket(url, ['sourdaw', AUTH_TOKEN], options);
    sockets.add(socket);
    await new Promise<void>((resolve, reject) => {
        socket.once('open', resolve);
        socket.once('error', reject);
    });
    return socket;
}

function nextMessage(socket: WebSocket, timeoutMs = 1_000): Promise<ServerMessage> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('message timed out')), timeoutMs);
        socket.once('message', (data) => {
            clearTimeout(timer);
            resolve(JSON.parse(rawDataToString(data)) as ServerMessage);
        });
    });
}

function rawDataToString(data: RawData): string {
    if (data instanceof ArrayBuffer) {
        return Buffer.from(data).toString();
    }

    if (Array.isArray(data)) {
        return Buffer.concat(data).toString();
    }

    return data.toString();
}

function isPausable(value: unknown): value is { pause: () => void } {
    return typeof value === 'object' && value !== null && 'pause' in value && typeof value.pause === 'function';
}

async function waitForExit(process: ChildProcessWithoutNullStreams): Promise<{ code: number | null; stderr: string }> {
    if (process.exitCode === null && process.signalCode === null) {
        await once(process, 'exit');
    }

    return { code: process.exitCode, stderr: stderrByProcess.get(process) ?? '' };
}

async function closeCodeWithin(socket: WebSocket): Promise<number> {
    return Promise.race([
        once(socket, 'close').then(([code]) => code as number),
        new Promise<number>((resolve) => setTimeout(() => resolve(-1), 200)),
    ]);
}

async function rejectedConnectionStatus(url: string, protocols: string[]): Promise<number> {
    const socket = new WebSocket(url, protocols);
    socket.on('error', () => undefined);
    const status = await new Promise<number>((resolve) => {
        socket.once('unexpected-response', (request, response) => {
            request.abort();
            response.resume();
            resolve(response.statusCode ?? 0);
        });
        socket.once('open', () => resolve(101));
    });
    socket.removeAllListeners();
    socket.on('error', () => undefined);
    socket.terminate();
    await new Promise<void>((resolve) => setImmediate(resolve));
    return status;
}

async function join(socket: WebSocket, sessionId: string, peerId: string): Promise<ServerMessage> {
    const response = nextMessage(socket);
    socket.send(JSON.stringify({ type: 'join', sessionId, peerId, name: peerId }));
    return response;
}

afterEach(async () => {
    for (const socket of sockets) {
        socket.terminate();
    }
    sockets.clear();

    for (const process of processes) {
        if (process.exitCode !== null || process.signalCode !== null) {
            continue;
        }

        const exited = once(process, 'exit');
        process.kill('SIGTERM');
        await exited;
    }
    processes.clear();
    stderrByProcess.clear();
});

void test('does not hang cleanup when the relay already exited', { timeout: 1_000 }, async () => {
    const { process } = await startServer();
    const exited = once(process, 'exit');
    process.kill('SIGKILL');
    await exited;
});

void test('rejects connections without the configured bearer token', async () => {
    const { url } = await startServer();
    assert.equal(await rejectedConnectionStatus(url, ['sourdaw']), 401);
});

void test('rejects oversized relay messages at the websocket boundary', async () => {
    const { url } = await startServer();
    const socket = await connect(url);
    await join(socket, 'session', 'peer');

    socket.send(
        JSON.stringify({ type: 'state-update', sessionId: 'session', peerId: 'peer', state: 'x'.repeat(2_000) })
    );
    assert.equal(await closeCodeWithin(socket), 1009);
});

void test('closes a client that exceeds the configured message rate', async () => {
    const { url } = await startServer({ COLLAB_RATE_LIMIT_PER_SECOND: '2' });
    const socket = await connect(url);
    await join(socket, 'session', 'peer');

    const cursor = JSON.stringify({
        type: 'cursor',
        sessionId: 'session',
        peerId: 'peer',
        cursor: { trackId: 't', beat: 1 },
    });
    socket.send(cursor);
    socket.send(cursor);
    assert.equal(await closeCodeWithin(socket), 1008);
});

void test('closes a client that exceeds the configured byte rate', async () => {
    const { url } = await startServer({ COLLAB_RATE_LIMIT_BYTES_PER_SECOND: '500' });
    const socket = await connect(url);
    await join(socket, 'session', 'peer');

    socket.send(JSON.stringify({ type: 'state-update', sessionId: 'session', peerId: 'peer', state: 'x'.repeat(500) }));
    assert.equal(await closeCodeWithin(socket), 1008);
});

void test('does not reset the message budget at a fixed window boundary', async () => {
    const { url } = await startServer({ COLLAB_RATE_LIMIT_PER_SECOND: '3' });
    const socket = await connect(url);
    await join(socket, 'session', 'peer');

    const cursor = JSON.stringify({
        type: 'cursor',
        sessionId: 'session',
        peerId: 'peer',
        cursor: { trackId: 't', beat: 1 },
    });
    await new Promise((resolve) => setTimeout(resolve, 950));
    socket.send(cursor);
    socket.send(cursor);
    await new Promise((resolve) => setTimeout(resolve, 100));
    socket.send(cursor);
    socket.send(cursor);

    assert.equal(await closeCodeWithin(socket), 1008);
});

void test('does not refill the message budget after a wall-clock jump', async () => {
    const { url } = await startServer({
        COLLAB_RATE_LIMIT_PER_SECOND: '3',
        COLLAB_TEST_FORWARD_CLOCK: '1',
    });
    const socket = await connect(url);
    await join(socket, 'session', 'peer');

    const cursor = JSON.stringify({
        type: 'cursor',
        sessionId: 'session',
        peerId: 'peer',
        cursor: { trackId: 't', beat: 1 },
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    socket.send(cursor);
    socket.send(cursor);
    socket.send(cursor);

    assert.equal(await closeCodeWithin(socket), 1008);
});

void test('disconnects a recipient before its outbound queue exceeds the configured cap', async () => {
    const { url } = await startServer({
        COLLAB_HEARTBEAT_MS: '300000',
        COLLAB_MAX_BUFFERED_BYTES: '4096',
        COLLAB_RATE_LIMIT_BYTES_PER_SECOND: String(256 * 1024 * 1024),
        COLLAB_RATE_LIMIT_PER_SECOND: '10000',
    });
    const sender = await connect(url);
    const recipient = await connect(url);
    await join(sender, 'session', 'sender');
    const peerJoined = nextMessage(sender);
    await join(recipient, 'session', 'recipient');
    await peerJoined;

    const transport: unknown = Reflect.get(recipient, '_socket');
    assert(isPausable(transport));
    transport.pause();

    const peerLeft = nextMessage(sender, 5_000);
    const update = JSON.stringify({
        type: 'state-update',
        sessionId: 'session',
        peerId: 'sender',
        state: 'x'.repeat(800),
    });
    for (let message = 0; message < 8_000; message += 1) {
        sender.send(update);
    }

    assert.deepEqual(await peerLeft, { type: 'peer-left', peerId: 'recipient', newHostId: null });
});

void test('caps source connections and releases capacity after close', async () => {
    const { url } = await startServer({ COLLAB_MAX_SOURCE_CONNECTIONS: '1' });
    const first = await connect(url);
    assert.equal(await rejectedConnectionStatus(url, ['sourdaw', AUTH_TOKEN]), 503);

    const closed = once(first, 'close');
    first.terminate();
    await closed;
    const replacement = await connect(url);
    assert.equal(replacement.readyState, WebSocket.OPEN);
});

void test('caps total authenticated connections', async () => {
    const { url } = await startServer({ COLLAB_MAX_CONNECTIONS: '1' });
    await connect(url);
    assert.equal(await rejectedConnectionStatus(url, ['sourdaw', AUTH_TOKEN]), 503);
});

void test('caps sessions and peers without mutating existing membership', async () => {
    const { url } = await startServer({ COLLAB_MAX_PEERS_PER_SESSION: '1', COLLAB_MAX_SESSIONS: '1' });
    const host = await connect(url);
    const extraPeer = await connect(url);
    const extraSession = await connect(url);
    await join(host, 'session', 'host');

    assert.deepEqual(await join(extraPeer, 'session', 'guest'), { type: 'error', message: 'Session is full' });
    assert.deepEqual(await join(extraSession, 'other-session', 'other'), {
        type: 'error',
        message: 'Session limit reached',
    });
});

void test('rejects an invalid port with a controlled startup error', async () => {
    const process = spawnServer({ PORT: 'not-a-port' });
    const result = await waitForExit(process);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Invalid PORT/);
    assert.doesNotMatch(result.stderr, /ERR_SOCKET_BAD_PORT/);
});

void test('reports a port conflict without an unhandled error event', async () => {
    const { port } = await startServer();
    const process = spawnServer({ PORT: String(port) });
    const result = await waitForExit(process);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Collaboration server failed to start: EADDRINUSE/);
    assert.doesNotMatch(result.stderr, /Unhandled 'error' event/);
});

void test('rejects a duplicate peer without letting its close destroy the live host', async () => {
    const { url } = await startServer();
    const host = await connect(url);
    const guest = await connect(url);
    const duplicate = await connect(url);

    assert.equal((await join(host, 'session', 'host')).isHost, true);
    await join(guest, 'session', 'guest');
    assert.deepEqual(await join(duplicate, 'session', 'host'), {
        type: 'error',
        message: 'Peer ID already in use',
    });

    duplicate.terminate();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const forwarded = nextMessage(host);
    guest.send(JSON.stringify({ type: 'action', sessionId: 'session', peerId: 'guest', action: {}, timestamp: 1 }));
    assert.equal((await forwarded).type, 'action');
});

void test('rejects a second identity on an already joined socket', async () => {
    const { url } = await startServer();
    const socket = await connect(url);
    await join(socket, 'first-session', 'first-peer');

    const response = await join(socket, 'second-session', 'second-peer');
    assert.deepEqual(response, { type: 'error', message: 'Peer already joined' });
});

void test('reaps an unresponsive host and transfers host authority', async () => {
    const { url } = await startServer();
    const host = await connect(url, { autoPong: false });
    const guest = await connect(url);
    await join(host, 'session', 'host');
    await join(guest, 'session', 'guest');

    const response = await nextMessage(guest, 1_000);
    assert.deepEqual(response, { type: 'peer-left', peerId: 'host', newHostId: 'guest' });
});

void test('rejects sync responses sent by a non-host peer', async () => {
    const { url } = await startServer();
    const host = await connect(url);
    const guest = await connect(url);
    await join(host, 'session', 'host');
    await join(guest, 'session', 'guest');

    const response = nextMessage(guest);
    guest.send(
        JSON.stringify({
            type: 'sync-response',
            sessionId: 'session',
            peerId: 'guest',
            targetPeerId: 'host',
            state: {},
        })
    );
    assert.deepEqual(await response, { type: 'error', message: 'Only the host may send sync responses' });
});
