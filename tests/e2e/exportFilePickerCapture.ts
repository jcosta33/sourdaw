import { mkdir, open } from 'node:fs/promises';
import { dirname } from 'node:path';

import { type Page } from '@playwright/test';

const PICKER_REQUEST_BINDING = '__sourdawCapturePickerRequest';
const WRITE_BINDING = '__sourdawCapturePickerWrite';
const CLOSE_BINDING = '__sourdawCapturePickerClose';
const ABORT_BINDING = '__sourdawCapturePickerAbort';
const ORIGINAL_PICKER_DESCRIPTOR = '__sourdawCapturePickerOriginalDescriptor';
const pagesWithPickerInitScript = new WeakSet<Page>();

type Deferred<T> = {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (error: unknown) => void;
};

function createDeferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    void promise.catch(() => undefined);
    return { promise, resolve, reject };
}

type BindingRegistration = { dispose: () => Promise<void> | void };

type PickerShimOptions = {
    originalDescriptorKey: string;
    pickerRequestBinding: string;
    writeBinding: string;
    closeBinding: string;
    abortBinding: string;
};

function installPickerShim({
    originalDescriptorKey,
    pickerRequestBinding,
    writeBinding,
    closeBinding,
    abortBinding,
}: PickerShimOptions): void {
    if (typeof Reflect.get(window, pickerRequestBinding) !== 'function') {
        return;
    }
    if (!Object.hasOwn(window, originalDescriptorKey)) {
        const original = Object.getOwnPropertyDescriptor(window, 'showSaveFilePicker') ?? null;
        Object.defineProperty(window, originalDescriptorKey, {
            configurable: true,
            value: original,
        });
    }
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
                createWritable: async () => ({
                    write: (bytes: Uint8Array) => callBinding(writeBinding, bytes),
                    close: () => callBinding(closeBinding),
                    abort: () => callBinding(abortBinding),
                }),
            };
        },
    });
}

function removePickerShim(originalDescriptorKey: string): void {
    if (!Object.hasOwn(window, originalDescriptorKey)) {
        return;
    }
    const original = Reflect.get(window, originalDescriptorKey) as PropertyDescriptor | null;
    if (original) {
        Object.defineProperty(window, 'showSaveFilePicker', original);
    } else {
        Reflect.deleteProperty(window, 'showSaveFilePicker');
    }
    Reflect.deleteProperty(window, originalDescriptorKey);
}

export type FilePickerCapture = {
    path: string;
    pickerFilename: Promise<string>;
    waitForClose: () => Promise<void>;
    bytesWritten: () => number;
    writeCount: () => number;
    abortCount: () => number;
    dispose: () => Promise<void>;
};

/**
 * Installs a real Save File picker capability whose writes are serialized into
 * a test-owned file. Each app chunk crosses Playwright as a Uint8Array and is
 * awaited before the next chunk, keeping the capture sink backpressured.
 */
export async function installFilePickerCapture(page: Page, path: string): Promise<FilePickerCapture> {
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
    let fileClosed = false;
    let writableClosed = false;
    let writableAborted = false;
    let writeInProgress = false;
    let captureFailed = false;
    let pickerShimActive = false;

    const failCapture = (error: unknown): void => {
        if (captureFailed) {
            return;
        }
        captureFailed = true;
        bindingFailure.reject(error);
        filename.reject(error);
        closed.reject(error);
        aborted.reject(error);
    };

    try {
        registrations.push(
            await page.exposeBinding(PICKER_REQUEST_BINDING, async (_source, suggestedName: unknown) => {
                if (typeof suggestedName !== 'string' || suggestedName.length === 0) {
                    const error = new TypeError('The app opened its file picker without a suggested filename.');
                    failCapture(error);
                    throw error;
                }
                filename.resolve(suggestedName);
            })
        );
        registrations.push(
            await page.exposeBinding(WRITE_BINDING, async (_source, rawBytes: unknown) => {
                if (!(rawBytes instanceof Uint8Array)) {
                    const error = new TypeError('The app wrote a non-byte value to its file picker.');
                    failCapture(error);
                    throw error;
                }
                if (fileClosed || writableClosed || writableAborted || writeInProgress) {
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
            await page.exposeBinding(CLOSE_BINDING, async () => {
                if (fileClosed || writableAborted || writableClosed) {
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
            await page.exposeBinding(ABORT_BINDING, async () => {
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
        const pickerShimOptions = {
            originalDescriptorKey: ORIGINAL_PICKER_DESCRIPTOR,
            pickerRequestBinding: PICKER_REQUEST_BINDING,
            writeBinding: WRITE_BINDING,
            closeBinding: CLOSE_BINDING,
            abortBinding: ABORT_BINDING,
        };
        if (!pagesWithPickerInitScript.has(page)) {
            await page.addInitScript(installPickerShim, pickerShimOptions);
            pagesWithPickerInitScript.add(page);
        }
        await page.evaluate(installPickerShim, pickerShimOptions);
        pickerShimActive = true;
    } catch (error) {
        failCapture(error);
        if (pickerShimActive && !page.isClosed()) {
            try {
                await page.evaluate(removePickerShim, ORIGINAL_PICKER_DESCRIPTOR);
            } catch {
                // Preserve the original installation failure if the document is already tearing down.
            }
        }
        if (!fileClosed) {
            await file.close();
        }
        await Promise.all(registrations.map((registration) => registration.dispose()));
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
        async dispose() {
            if (!page.isClosed()) {
                try {
                    await page.evaluate(removePickerShim, ORIGINAL_PICKER_DESCRIPTOR);
                } catch {
                    // Do not replace the export result with a document teardown error.
                }
            }
            await Promise.all(registrations.map((registration) => registration.dispose()));
            if (!fileClosed) {
                await file.close();
                fileClosed = true;
            }
        },
    };
}
