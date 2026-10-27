import { fork } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { get } from 'node:http';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { expect, it } from 'vitest';

it('keeps Vite serving after an unmatched websocket upgrade is reset', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vite-upgrade-reset-'));
    writeFileSync(join(root, 'index.html'), '<!doctype html><title>still serving</title>');
    const child = fork(
        resolve('scripts/__tests__/fixtures/viteUpgradeReset.mjs'),
        [resolve('node_modules/vite/dist/node/index.js'), root],
        { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] }
    );
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
    });
    const messages: Array<{ type: string; pid: number; port?: number; code?: string }> = [];
    child.on('message', (message: { type: string; pid: number; port?: number; code?: string }) =>
        messages.push(message)
    );
    const exit = new Promise<void>((_resolve) => child.once('exit', () => _resolve()));
    const waitFor = async (type: string) => {
        const deadline = Date.now() + 5_000;
        while (Date.now() < deadline) {
            const message = messages.find((item) => item.type === type);
            if (message) {
                return message;
            }
            if (child.exitCode !== null || child.signalCode !== null) {
                throw new Error(`Vite child exited: ${stderr}`);
            }
            await new Promise((_resolve) => setTimeout(_resolve, 10));
        }
        throw new Error(`Timed out waiting for ${type}: ${stderr}`);
    };
    let socket: ReturnType<typeof createConnection> | undefined;
    try {
        const ready = await waitFor('ready');
        const port = ready.port;
        if (port === undefined) {
            throw new Error('Vite did not report a port');
        }
        socket = createConnection({ host: '127.0.0.1', port });
        socket.setTimeout(5_000, () => socket?.destroy(new Error('Upgrade socket timed out')));
        await new Promise<void>((_resolve, reject) => {
            socket?.once('connect', _resolve);
            socket?.once('error', reject);
        });
        socket.write(
            [
                'GET /unhandled-upgrade HTTP/1.1',
                `Host: 127.0.0.1:${port}`,
                'Connection: Upgrade',
                'Upgrade: websocket',
                'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
                'Sec-WebSocket-Version: 13',
                '',
                '',
            ].join('\r\n')
        );
        const upgrade = await waitFor('upgrade');
        socket.resetAndDestroy();
        const error = await waitFor('socket-error');
        expect(error.code).toBe('ECONNRESET');
        expect(upgrade.pid).toBe(ready.pid);
        expect(error.pid).toBe(ready.pid);
        const response = await new Promise<{ status: number | undefined; body: string }>((_resolve, reject) => {
            const request = get({ host: '127.0.0.1', port, path: '/', timeout: 5_000 }, (res) => {
                let body = '';
                res.setEncoding('utf8');
                res.on('data', (chunk: string) => {
                    body += chunk;
                });
                res.once('end', () => _resolve({ status: res.statusCode, body }));
                res.once('error', reject);
            });
            request.once('timeout', () => request.destroy(new Error('HTTP request timed out')));
            request.once('error', reject);
        });
        expect(response.status).toBe(200);
        expect(response.body).toContain('still serving');
        expect(child.pid).toBe(ready.pid);
        expect(child.exitCode).toBeNull();
        expect(child.signalCode).toBeNull();
    } finally {
        socket?.destroy();
        if (child.exitCode === null && child.signalCode === null) {
            child.kill('SIGTERM');
        }
        await Promise.race([exit, new Promise<void>((_resolve) => setTimeout(_resolve, 2_000))]);
        if (child.exitCode === null && child.signalCode === null) {
            child.kill('SIGKILL');
            await exit;
        }
        rmSync(root, { recursive: true, force: true });
    }
}, 20_000);
