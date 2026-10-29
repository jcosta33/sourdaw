import { subscribe, unsubscribe } from 'node:diagnostics_channel';
import { errorMonitor, type EventEmitter } from 'node:events';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';

import { createJournal } from './journal.ts';

type HttpMessage = { request: IncomingMessage; response: ServerResponse; socket: Socket };

export function monitorTransportError(emitter: EventEmitter, observe: (error: NodeJS.ErrnoException) => void): void {
    emitter.once(errorMonitor, observe);
}

export function installViteTransportProbe(output: string): () => void {
    const journal = createJournal(output);
    let active = true;
    const record: typeof journal = (kind, data) => {
        if (!active) {
            return;
        }
        try {
            journal(kind, data);
        } catch {
            process.stderr.write('[reload-transport-probe] journal write failed\n');
        }
    };
    const requests = new WeakMap<ServerResponse, number>();
    const sockets = new WeakMap<Socket, number>();
    let nextRequest = 0;
    let nextSocket = 0;
    const socketId = (socket: Socket): number => {
        let id = sockets.get(socket);
        if (id === undefined) {
            id = ++nextSocket;
            sockets.set(socket, id);
        }
        return id;
    };
    const socket = (message: unknown): void => {
        const accepted = (message as { socket: Socket }).socket;
        const id = socketId(accepted);
        record('socket-accepted', { pid: process.pid, socketId: id });
        accepted.once('close', (hadError) => record('socket-close', { pid: process.pid, socketId: id, hadError }));
        monitorTransportError(accepted, (error) =>
            record('socket-error', { pid: process.pid, socketId: id, code: error.code, name: error.name })
        );
    };
    const requestStart = (message: unknown): void => {
        const { request, response, socket: accepted } = message as HttpMessage;
        const id = ++nextRequest;
        requests.set(response, id);
        const path = (request.url ?? '/').split('?')[0];
        record('http-request-start', {
            pid: process.pid,
            requestId: id,
            socketId: socketId(accepted),
            method: request.method,
            path,
        });
        request.once('aborted', () => record('http-request-aborted', { pid: process.pid, requestId: id }));
        monitorTransportError(request, (error) =>
            record('http-request-error', { pid: process.pid, requestId: id, code: error.code, name: error.name })
        );
        response.once('close', () =>
            record('http-response-close', {
                pid: process.pid,
                requestId: id,
                writableFinished: response.writableFinished,
            })
        );
        monitorTransportError(response, (error) =>
            record('http-response-error', { pid: process.pid, requestId: id, code: error.code, name: error.name })
        );
    };
    const responseFinish = (message: unknown): void => {
        const { response } = message as HttpMessage;
        record('http-response-finish', {
            pid: process.pid,
            requestId: requests.get(response),
            statusCode: response.statusCode,
        });
    };
    subscribe('net.server.socket', socket);
    subscribe('http.server.request.start', requestStart);
    subscribe('http.server.response.finish', responseFinish);
    const delay = monitorEventLoopDelay({ resolution: 20 });
    delay.enable();
    let previousClock = performance.now();
    let previousCpu = process.cpuUsage();
    let previousUtilization = performance.eventLoopUtilization();
    const timer = setInterval(() => {
        const now = performance.now();
        const cpu = process.cpuUsage(previousCpu);
        const utilization = performance.eventLoopUtilization(previousUtilization);
        record('vite-heartbeat', {
            pid: process.pid,
            intervalMs: now - previousClock,
            eventLoopDelayMaxMs: delay.max / 1e6,
            cpuUserMicros: cpu.user,
            cpuSystemMicros: cpu.system,
            eventLoopUtilization: utilization.utilization,
        });
        previousClock = now;
        previousCpu = process.cpuUsage();
        previousUtilization = performance.eventLoopUtilization();
        delay.reset();
    }, 2_000);
    timer.unref();
    record('vite-probe-ready', { pid: process.pid, argv0: process.argv[1] });
    return () => {
        clearInterval(timer);
        delay.disable();
        unsubscribe('net.server.socket', socket);
        unsubscribe('http.server.request.start', requestStart);
        unsubscribe('http.server.response.finish', responseFinish);
        record('vite-probe-stopped', { pid: process.pid });
        active = false;
    };
}

if (process.argv[1]?.endsWith('/vite/bin/vite.js')) {
    const output = process.env.RELOAD_TRANSPORT_PROBE_OUTPUT;
    if (!output?.startsWith('/')) {
        throw new Error('Vite transport probe requires an absolute output path');
    }
    installViteTransportProbe(output);
}
