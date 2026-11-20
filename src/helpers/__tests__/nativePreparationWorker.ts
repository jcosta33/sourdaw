import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MessageChannel, Worker as NativeWorker } from 'node:worker_threads';

import { vi } from 'vitest';

const pendingTerminations: Promise<number>[] = [];
let nextHold: ReturnType<typeof holdNextNativePreparation> | undefined;

export function holdNextNativePreparation(): {
    requested: Promise<void>;
    release: () => void;
    arrive: () => Promise<void>;
} {
    const requested = Promise.withResolvers<void>();
    const released = Promise.withResolvers<void>();
    const hold = {
        requested: requested.promise,
        release: () => released.resolve(),
        arrive: () => {
            requested.resolve();
            return released.promise;
        },
    };
    nextHold = hold;
    return hold;
}

// Filesystem/module loading is the platform boundary. The entry, runtime,
// reconciler, protocol and installed native WASM execute in the other isolate.
const bootstrap = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const localRequire = Module.createRequire(workerData.entry);
const ts = localRequire('typescript');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function(specifier, parent, ...rest) {
    if (specifier.startsWith('#/')) {
        specifier = path.join(workerData.root, 'src', specifier.slice(2));
    }
    return originalResolve.call(this, specifier, parent, ...rest);
};
require.extensions['.ts'] = function(module, filename) {
    const source = fs.readFileSync(filename, 'utf8');
    const result = ts.transpileModule(source, { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
        esModuleInterop: true
    }});
    module._compile(result.outputText, filename);
};
require.extensions['.wasm'] = function(module, filename) {
    module.exports = Uint8Array.from(fs.readFileSync(filename));
};
global.self = {
    location: { origin: 'http://native-preparation.test' },
    postMessage(data, transfer) { parentPort.postMessage(data, transfer); }
};
require(workerData.entry);
parentPort.on('message', data => self.onmessage({ data, origin: '' }));
`;

export class NativePreparationWorker {
    onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
    onerror: (() => void) | null = null;
    onmessageerror: (() => void) | null = null;
    private readonly worker: NativeWorker;
    private releaseResponse: Promise<void> | undefined;

    constructor(url: URL) {
        const root = process.cwd();
        const pathname = url.pathname;
        // Only prospective preparation uses this transport. Persistence uses
        // the repository's platform fallback when its own Worker is absent.
        if (!pathname.endsWith('/prospectiveMutationWorker.ts')) {
            throw new Error('The native preparation fixture only hosts the prospective Worker');
        }
        if (url.protocol !== 'file:' && !pathname.startsWith('/src/')) {
            throw new Error(`Unsupported actual Worker module URL: ${url.href}`);
        }
        const entry = url.protocol === 'file:' ? fileURLToPath(url.href) : resolve(root, `.${pathname}`);
        // Verify the actual entry exists rather than redirecting to a mirrored handler.
        readFileSync(entry);
        this.worker = new NativeWorker(bootstrap, { eval: true, workerData: { entry, root } });
        this.worker.on('message', (data: unknown) => {
            // Native transport gives this realm its own buffers. Re-home only
            // byte arrays; no protocol status, heads or metadata are invented.
            const rehome = (value: unknown): unknown => {
                if (ArrayBuffer.isView(value) && Object.prototype.toString.call(value) === '[object Uint8Array]') {
                    return Uint8Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
                }
                if (Array.isArray(value)) {
                    return value.map(rehome);
                }
                if (value && typeof value === 'object') {
                    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, rehome(child)]));
                }
                return value;
            };
            const deliver = () => this.onmessage?.(new MessageEvent('message', { data: rehome(data) }));
            if (this.releaseResponse) {
                void this.releaseResponse.then(deliver);
            } else {
                deliver();
            }
        });
        this.worker.on('error', () => this.onerror?.());
        this.worker.on('messageerror', () => this.onmessageerror?.());
    }

    postMessage(data: unknown, transfer: ArrayBuffer[]): void {
        this.releaseResponse = nextHold?.arrive();
        nextHold = undefined;
        this.worker.postMessage(data, transfer);
    }

    terminate(): void {
        pendingTerminations.push(this.worker.terminate());
    }
}

export function installNativePreparationWorker(): void {
    vi.stubGlobal('Worker', NativePreparationWorker);
    vi.stubGlobal('MessageChannel', MessageChannel);
}

export async function settleNativePreparationWorkers(): Promise<void> {
    nextHold?.release();
    nextHold = undefined;
    await Promise.all(pendingTerminations.splice(0));
}
