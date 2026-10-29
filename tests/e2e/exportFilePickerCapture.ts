import { randomUUID } from 'node:crypto';
import { mkdir, open } from 'node:fs/promises';
import { dirname } from 'node:path';

import { type Frame, type Page } from '@playwright/test';

const PICKER_REQUEST_BINDING = '__sourdawCapturePickerRequest';
const WRITE_BINDING = '__sourdawCapturePickerWrite';
const CLOSE_BINDING = '__sourdawCapturePickerClose';
const ABORT_BINDING = '__sourdawCapturePickerAbort';
const WRITABLE_BINDING = '__sourdawCapturePickerWritable';

type Deferred<TValue> = {
    promise: Promise<TValue>;
    resolve: (value: TValue) => void;
    reject: (error: unknown) => void;
};

function createDeferred<TValue>(): Deferred<TValue> {
    let resolve!: (value: TValue) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<TValue>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    void promise.catch(() => undefined);
    return { promise, resolve, reject };
}

type BindingRegistration = { dispose: () => Promise<void> | void };

export type FilePickerCapture = {
    path: string;
    pickerFilename: Promise<string>;
    waitForClose: () => Promise<void>;
    bytesWritten: () => number;
    writeCount: () => number;
    abortCount: () => number;
    closeCount: () => number;
    pickerCount: () => number;
    writableCount: () => number;
    waitForAbort: () => Promise<void>;
    assertHealthy: () => void;
    retire: () => Promise<void>;
    dispose: () => Promise<void>;
};

type CapturePage = Pick<Page, 'addInitScript' | 'exposeBinding'> & {
    frames: () => Pick<Frame, 'evaluate'>[];
};

function installPicker({
    pickerRequestBinding,
    writableBinding,
    writeBinding,
    closeBinding,
    abortBinding,
}: {
    pickerRequestBinding: string;
    writableBinding: string;
    writeBinding: string;
    closeBinding: string;
    abortBinding: string;
}): void {
    const callBinding = (name: string, ...args: unknown[]): Promise<unknown> => {
        const binding = Reflect.get(window, name);
        if (typeof binding !== 'function') {
            throw new Error(`Missing test file picker binding: ${name}`);
        }
        return (binding as (...values: unknown[]) => Promise<unknown>)(...args);
    };
    Object.defineProperty(window, 'showSaveFilePicker', {
        configurable: true,
        value: async (options: { suggestedName: string }) => {
            await callBinding(pickerRequestBinding, options.suggestedName);
            return {
                createWritable: async () => {
                    await callBinding(writableBinding);
                    return {
                        write: (bytes: Uint8Array) => callBinding(writeBinding, bytes),
                        close: () => callBinding(closeBinding),
                        abort: () => callBinding(abortBinding),
                    };
                },
            };
        },
    });
}

/**
 * Installs a controlled Save File picker capability whose real writes are serialized into
 * a test-owned file. Each app chunk crosses Playwright as a Uint8Array and is
 * awaited before the next chunk, keeping the capture sink backpressured.
 */
export async function installFilePickerCapture(
    page: CapturePage,
    path: string,
    options: { initializeCurrentFrames?: boolean } = {}
): Promise<FilePickerCapture> {
    await mkdir(dirname(path), { recursive: true });
    const file = await open(path, 'w');
    const filename = createDeferred<string>();
    const closed = createDeferred<void>();
    const aborted = createDeferred<void>();
    const bindingFailure = createDeferred<never>();
    const registrations: BindingRegistration[] = [];
    let position = 0;
    let writes = 0;
    let aborts = 0;
    let closes = 0;
    let requests = 0;
    let writableRequests = 0;
    let fileClosed = false;
    let writableClosed = false;
    let writableAborted = false;
    let writeInProgress = false;
    let captureFailed = false;
    let failure: unknown;
    let disposed = false;
    let installer: BindingRegistration | undefined;
    let retired = false;
    // An old writable must never find a later attempt's binding after disposal.
    const suffix = randomUUID();
    const names = {
        pickerRequestBinding: `${PICKER_REQUEST_BINDING}_${suffix}`,
        writableBinding: `${WRITABLE_BINDING}_${suffix}`,
        writeBinding: `${WRITE_BINDING}_${suffix}`,
        closeBinding: `${CLOSE_BINDING}_${suffix}`,
        abortBinding: `${ABORT_BINDING}_${suffix}`,
    };

    const failCapture = (error: unknown): void => {
        if (captureFailed) {
            return;
        }
        captureFailed = true;
        failure = error;
        bindingFailure.reject(error);
        filename.reject(error);
        closed.reject(error);
        aborted.reject(error);
    };

    // Keep the binding owner until disposal so late calls poison their original capture.
    const retire = async (): Promise<void> => {
        if (!retired) {
            retired = true;
            await installer?.dispose();
        }
    };

    try {
        registrations.push(
            await page.exposeBinding(names.pickerRequestBinding, async (_source, suggestedName: unknown) => {
                requests += 1;
                if (
                    captureFailed ||
                    fileClosed ||
                    requests !== 1 ||
                    typeof suggestedName !== 'string' ||
                    suggestedName.length === 0
                ) {
                    const error = new TypeError('The app must request one file picker with a suggested filename.');
                    failCapture(error);
                    throw error;
                }
                filename.resolve(suggestedName);
            })
        );
        registrations.push(
            await page.exposeBinding(names.writableBinding, async () => {
                writableRequests += 1;
                if (captureFailed || fileClosed || requests !== 1 || writableRequests !== 1) {
                    const error = new Error('The app must request one writable for this file picker.');
                    failCapture(error);
                    throw error;
                }
            })
        );
        registrations.push(
            await page.exposeBinding(names.writeBinding, async (_source, rawBytes: unknown) => {
                if (!(rawBytes instanceof Uint8Array)) {
                    const error = new TypeError('The app wrote a non-byte value to its file picker.');
                    failCapture(error);
                    throw error;
                }
                if (
                    captureFailed ||
                    writableRequests !== 1 ||
                    fileClosed ||
                    writableClosed ||
                    writableAborted ||
                    writeInProgress
                ) {
                    const error = new Error('The app wrote to a closed or concurrently used file picker sink.');
                    failCapture(error);
                    throw error;
                }
                writeInProgress = true;
                try {
                    const bytes = Buffer.from(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength);
                    let offset = 0;
                    while (offset < bytes.byteLength) {
                        const result = await file.write(bytes, offset, bytes.byteLength - offset, position);
                        if (result.bytesWritten === 0) {
                            throw new Error('The test-owned file picker sink stopped accepting bytes.');
                        }
                        offset += result.bytesWritten;
                        position += result.bytesWritten;
                    }
                    writes += 1;
                } catch (error) {
                    failCapture(error);
                    throw error;
                } finally {
                    writeInProgress = false;
                }
            })
        );
        registrations.push(
            await page.exposeBinding(names.closeBinding, async () => {
                closes += 1;
                if (captureFailed || writableRequests !== 1 || fileClosed || writableAborted || writableClosed) {
                    const error = new Error('The app closed its file picker more than once or after abort.');
                    failCapture(error);
                    throw error;
                }
                try {
                    await file.sync();
                    await file.close();
                    fileClosed = true;
                    writableClosed = true;
                    closed.resolve();
                } catch (error) {
                    failCapture(error);
                    throw error;
                }
            })
        );
        registrations.push(
            await page.exposeBinding(names.abortBinding, async () => {
                aborts += 1;
                if (fileClosed || writableClosed || writableAborted) {
                    return;
                }
                try {
                    await file.close();
                    fileClosed = true;
                    writableAborted = true;
                    aborted.resolve();
                } catch (error) {
                    failCapture(error);
                    throw error;
                }
            })
        );
        installer = await page.addInitScript(installPicker, names);
        if (options.initializeCurrentFrames) {
            for (const frame of page.frames()) {
                await frame.evaluate(installPicker, names);
            }
        }
    } catch (error) {
        failCapture(error);
        if (!fileClosed) {
            await file.close();
        }
        await Promise.all(registrations.map((registration) => registration.dispose()));
        await retire();
        throw error;
    }

    return {
        path,
        pickerFilename: filename.promise,
        async waitForClose() {
            const outcome = await Promise.race([
                closed.promise.then(() => 'closed' as const),
                aborted.promise.then(() => 'aborted' as const),
                bindingFailure.promise,
            ]);
            if (outcome !== 'closed') {
                throw new Error('The app aborted its file picker before closing it.');
            }
        },
        bytesWritten: () => position,
        writeCount: () => writes,
        abortCount: () => aborts,
        closeCount: () => closes,
        pickerCount: () => requests,
        writableCount: () => writableRequests,
        retire,
        async waitForAbort() {
            await Promise.race([
                aborted.promise,
                closed.promise.then(() => {
                    throw new Error('The app closed its file picker instead of aborting it.');
                }),
                bindingFailure.promise,
            ]);
        },
        assertHealthy() {
            if (captureFailed) {
                throw failure;
            }
        },
        async dispose() {
            if (disposed) {
                return;
            }
            disposed = true;
            await retire();
            await Promise.all(registrations.map((registration) => registration.dispose()));
            if (!fileClosed) {
                await file.close();
                fileClosed = true;
            }
        },
    };
}
