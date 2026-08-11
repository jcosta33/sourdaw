import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer } from 'node:net';
import { afterEach, test } from 'node:test';

import WebSocket, { type RawData } from 'ws';

type ServerMessage = {
    type: string;
    isHost?: boolean;
    message?: string;
    newHostId?: string | null;
};

const processes = new Set<ChildProcessWithoutNullStreams>();
const sockets = new Set<WebSocket>();

async function getFreePort(): Promise<number> {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert(address && typeof address === 'object');
    const { port } = address;
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    return port;
}

async function startServer(): Promise<{ process: ChildProcessWithoutNullStreams; url: string }> {
    const port = await getFreePort();
    const process = spawn('./node_modules/.bin/tsx', ['collab-server.ts'], {
        cwd: globalThis.process.cwd(),
        env: { ...globalThis.process.env, COLLAB_HEARTBEAT_MS: '40', PORT: String(port) },
        stdio: 'pipe',
    });
    processes.add(process);

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

    return { process, url: `ws://127.0.0.1:${port}` };
}

async function connect(url: string, options?: { autoPong: boolean }): Promise<WebSocket> {
    const socket = new WebSocket(url, options);
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
        process.kill('SIGTERM');
        await new Promise<void>((resolve) => process.once('exit', () => resolve()));
    }
    processes.clear();
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
