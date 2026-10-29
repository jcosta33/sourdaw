import { mkdtemp, open, readFile, readdir, rmdir, unlink, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installFilePickerCapture, type FilePickerCapture } from '../../tests/e2e/exportFilePickerCapture';

const io = {
    limit: Number.POSITIVE_INFINITY,
    beforeWrite: vi.fn<() => Promise<void>>(),
    beforeSync: vi.fn<() => Promise<void>>(),
};
let restoreIo = () => {};

function deferred() {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => {
        release = resolve;
    });
    return { promise, resolve: release };
}

type Writable = { write: (bytes: Uint8Array) => Promise<void>; close: () => Promise<void>; abort: () => Promise<void> };
type PickerHandle = { createWritable: () => Promise<Writable> };
type CapturePage = Parameters<typeof installFilePickerCapture>[0];

function createBrowserBoundary() {
    const bindings = new Map<string, (...args: unknown[]) => unknown>();
    const scripts = new Set<() => void>();
    let worlds: Record<string, unknown>[] = [{}, {}];
    const worldAt = (frame: number): Record<string, unknown> => {
        const world = worlds[frame];
        if (!world) {
            throw new TypeError('Calibration frame is unavailable');
        }
        return world;
    };
    const resource = (release: () => void) => {
        const dispose = async () => {
            release();
        };
        return { dispose, [Symbol.asyncDispose]: dispose };
    };
    const execute = (script: unknown, arg: unknown, world: Record<string, unknown>) => {
        if (typeof script !== 'function') {
            throw new TypeError('Expected the serialized picker callback');
        }
        return runInNewContext(`(${script.toString()})(options)`, { window: world, options: structuredClone(arg) });
    };
    const page: CapturePage = {
        exposeBinding: vi.fn<CapturePage['exposeBinding']>().mockImplementation(async (name, callback) => {
            if (bindings.has(name)) {
                throw new Error('Binding name reused');
            }
            const invoke = (...args: unknown[]) => Reflect.apply(callback, undefined, [{}, ...args]);
            bindings.set(name, invoke);
            for (const world of worlds) {
                world[name] = invoke;
            }
            return resource(() => {
                bindings.delete(name);
                for (const world of worlds) {
                    Reflect.deleteProperty(world, name);
                }
            });
        }),
        addInitScript: vi.fn<CapturePage['addInitScript']>().mockImplementation(async (script, arg) => {
            const initialize = () => {
                for (const world of worlds) {
                    execute(script, arg, world);
                }
            };
            scripts.add(initialize);
            return resource(() => {
                scripts.delete(initialize);
            });
        }),
        frames: () =>
            worlds.map((world) => ({
                evaluate: vi
                    .fn<ReturnType<CapturePage['frames']>[number]['evaluate']>()
                    .mockImplementation(async (script, arg) => execute(script, arg, world)),
            })),
    };
    return {
        page,
        bindingCount: () => bindings.size,
        installerCount: () => scripts.size,
        hasPicker: (frame = 1) => typeof worldAt(frame).showSaveFilePicker === 'function',
        navigate() {
            worlds = [{}, {}];
            for (const [name, binding] of bindings) {
                for (const world of worlds) {
                    world[name] = binding;
                }
            }
            for (const initialize of scripts) {
                initialize();
            }
        },
        async pick(filename = 'Sourdaw_Bake_1.wav', frame = 1): Promise<PickerHandle> {
            const picker = Reflect.get(worldAt(frame), 'showSaveFilePicker');
            if (typeof picker !== 'function') {
                throw new TypeError('Picker missing in current frame');
            }
            return Reflect.apply(picker, undefined, [{ suggestedName: filename }]);
        },
    };
}

let directory = '';
const captures: FilePickerCapture[] = [];

async function install(browser: ReturnType<typeof createBrowserBoundary>, name: string, current = true) {
    const capture = await installFilePickerCapture(browser.page, join(directory, name), {
        initializeCurrentFrames: current,
    });
    captures.push(capture);
    return capture;
}

beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'picker-capture-calibration-'));
    io.limit = Number.POSITIVE_INFINITY;
    io.beforeWrite.mockReset().mockResolvedValue(undefined);
    io.beforeSync.mockReset().mockResolvedValue(undefined);
    // Instrument actual FileHandles; the imported helper retains native open bindings.
    const sample = await open(join(directory, 'io-calibration-control'), 'w');
    const prototype: Pick<FileHandle, 'write' | 'sync'> = Object.getPrototypeOf(sample);
    await sample.close();
    const writeDescriptor = Object.getOwnPropertyDescriptor(prototype, 'write');
    const syncDescriptor = Object.getOwnPropertyDescriptor(prototype, 'sync');
    if (!writeDescriptor || !syncDescriptor) {
        throw new Error('Native FileHandle methods unavailable for calibration');
    }
    const nativeWrite = prototype.write;
    const nativeSync = prototype.sync;
    Object.defineProperty(prototype, 'write', {
        configurable: true,
        async value(this: FileHandle, bytes: Uint8Array, offset: number, length: number, position: number) {
            await io.beforeWrite();
            return nativeWrite.bind(this)(bytes, offset, Math.min(length, io.limit), position);
        },
    });
    Object.defineProperty(prototype, 'sync', {
        configurable: true,
        async value(this: FileHandle) {
            await io.beforeSync();
            await nativeSync.bind(this)();
        },
    });
    restoreIo = () => {
        Object.defineProperty(prototype, 'write', writeDescriptor);
        Object.defineProperty(prototype, 'sync', syncDescriptor);
    };
});

afterEach(async () => {
    try {
        await Promise.all(captures.splice(0).map((capture) => capture.dispose()));
        for (const name of await readdir(directory)) {
            await unlink(join(directory, name));
        }
        await rmdir(directory);
    } finally {
        restoreIo();
    }
});

describe('transactional picker capture with real test-owned files', () => {
    it('preserves the existing single-capture future-document API and awaited close', async () => {
        const browser = createBrowserBoundary();
        const capture = await installFilePickerCapture(browser.page, join(directory, 'single.wav'));
        captures.push(capture);
        expect(browser.hasPicker()).toBe(false);
        browser.navigate();
        const writer = await (await browser.pick()).createWritable();
        await writer.write(new Uint8Array([1, 2, 3]));
        await writer.close();
        await capture.waitForClose();
        expect(await capture.pickerFilename).toBe('Sourdaw_Bake_1.wav');
        expect(await readFile(capture.path)).toEqual(Buffer.from([1, 2, 3]));
        expect([capture.pickerCount(), capture.writableCount(), capture.closeCount(), capture.abortCount()]).toEqual([
            1, 1, 1, 0,
        ]);
        capture.assertHealthy();
        await capture.dispose();
        expect(browser.bindingCount()).toBe(0);
        expect(browser.installerCount()).toBe(0);
    });

    it('initializes both current frames and isolates five sequential owners including abort/recovery', async () => {
        const browser = createBrowserBoundary();
        for (let index = 0; index < 5; index++) {
            const capture = await install(browser, `attempt-${index}.bin`);
            expect(browser.hasPicker(0)).toBe(true);
            expect(browser.hasPicker(1)).toBe(true);
            expect(browser.installerCount()).toBe(1);
            const writer = await (await browser.pick()).createWritable();
            await writer.write(new Uint8Array([index]));
            if (index === 3) {
                await writer.abort();
                await capture.waitForAbort();
                expect(capture.closeCount()).toBe(0);
                await expect(capture.waitForClose()).rejects.toThrow('aborted');
            } else {
                await writer.close();
                await capture.waitForClose();
                expect(capture.abortCount()).toBe(0);
            }
            expect(await readFile(capture.path)).toEqual(Buffer.from([index]));
            await capture.retire();
            expect(browser.installerCount()).toBe(0);
        }
        for (const capture of captures) {
            capture.assertHealthy();
        }
    });

    it.each(['close', 'abort'] as const)(
        'rejects a late %s-owner write without contaminating recovery and retains failure health',
        async (finish) => {
            const browser = createBrowserBoundary();
            const prior = await install(browser, 'prior.incomplete');
            const oldWriter = await (await browser.pick()).createWritable();
            await oldWriter[finish]();
            await prior.retire();
            const next = await install(browser, 'recovery.wav');
            const writer = await (await browser.pick()).createWritable();
            await expect(oldWriter.write(new Uint8Array([9]))).rejects.toThrow('closed');
            expect(() => prior.assertHealthy()).toThrow('closed');
            expect(next.bytesWritten()).toBe(0);
            await writer.write(new Uint8Array([4, 5]));
            await writer.close();
            await next.waitForClose();
            expect(await readFile(next.path)).toEqual(Buffer.from([4, 5]));
            expect(await readFile(prior.path)).toHaveLength(0);
            next.assertHealthy();
        }
    );

    it.each(['picker', 'writable'] as const)(
        'refuses an extra %s request and reports persistent unhealthy state',
        async (extra) => {
            const browser = createBrowserBoundary();
            const capture = await install(browser, 'duplicate.bin');
            const handle = await browser.pick();
            await handle.createWritable();
            const request = extra === 'picker' ? browser.pick() : handle.createWritable();
            await expect(request).rejects.toThrow('one');
            expect(() => capture.assertHealthy()).toThrow('one');
            await expect(capture.waitForClose()).rejects.toThrow('one');
            expect(capture.closeCount()).toBe(0);
        }
    );

    it('drains real partial file writes without truncation or offset reuse', async () => {
        io.limit = 2;
        const browser = createBrowserBoundary();
        const capture = await install(browser, 'partial.bin');
        const writer = await (await browser.pick()).createWritable();
        await writer.write(new Uint8Array([1, 2, 3, 4, 5, 6, 7]));
        await writer.close();
        await capture.waitForClose();
        expect(await readFile(capture.path)).toEqual(Buffer.from([1, 2, 3, 4, 5, 6, 7]));
        expect(capture.bytesWritten()).toBe(7);
        expect(capture.writeCount()).toBe(1);
        expect(io.beforeWrite).toHaveBeenCalledTimes(4);
    });

    it('keeps write acknowledgement and successful close pending until real I/O and fsync complete', async () => {
        const writeEntered = deferred();
        const releaseWrite = deferred();
        const syncEntered = deferred();
        const releaseSync = deferred();
        io.beforeWrite.mockImplementation(async () => {
            writeEntered.resolve();
            await releaseWrite.promise;
        });
        io.beforeSync.mockImplementation(async () => {
            syncEntered.resolve();
            await releaseSync.promise;
        });
        const browser = createBrowserBoundary();
        const capture = await install(browser, 'backpressure.bin');
        const writer = await (await browser.pick()).createWritable();
        let written = false;
        const write = writer.write(new Uint8Array([7])).then(() => {
            written = true;
        });
        await writeEntered.promise;
        expect(written).toBe(false);
        expect(await readFile(capture.path)).toHaveLength(0);
        releaseWrite.resolve();
        await write;
        let closed = false;
        const observedClose = capture.waitForClose().then(() => {
            closed = true;
        });
        const close = writer.close();
        await syncEntered.promise;
        expect(closed).toBe(false);
        releaseSync.resolve();
        await close;
        await observedClose;
        expect(await readFile(capture.path)).toEqual(Buffer.from([7]));
    });

    it.each(['write', 'sync'] as const)(
        'propagates %s I/O failures into capture health and completion',
        async (operation) => {
            const error = new Error(`real sink ${operation} failure`);
            const browser = createBrowserBoundary();
            const capture = await install(browser, 'failed.incomplete');
            const writer = await (await browser.pick()).createWritable();
            if (operation === 'write') {
                io.beforeWrite.mockRejectedValueOnce(error);
                await expect(writer.write(new Uint8Array([1]))).rejects.toThrow(error);
            } else {
                io.beforeSync.mockRejectedValueOnce(error);
                await expect(writer.close()).rejects.toThrow(error);
            }
            await expect(capture.waitForClose()).rejects.toThrow(error);
            expect(() => capture.assertHealthy()).toThrow(error);
        }
    );
});
