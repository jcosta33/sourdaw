import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { pickFiles } from '../pickFiles';

const desktop = vi.hoisted(() => ({
    isDesktopRuntime: vi.fn(),
    desktopOpenDialog: vi.fn(),
    readFileBytes: vi.fn(),
}));

vi.mock('#/utils/desktopBridge', () => desktop);

function readBytes(file: File): Promise<number[]> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.addEventListener('load', () => {
            const result = reader.result;
            if (result === null || typeof result === 'string') {
                reject(new Error('Expected binary FileReader result'));
                return;
            }
            resolve(Array.from(new Uint8Array(result)));
        });
        reader.addEventListener('error', () => reject(reader.error ?? new Error('FileReader failed')));
        reader.readAsArrayBuffer(file);
    });
}

function selectFiles(input: HTMLInputElement, files: File[]): void {
    Object.defineProperty(input, 'files', { configurable: true, value: files });
    input.dispatchEvent(new Event('change'));
}

function requireFile(files: File[] | null, index = 0): File {
    const file = files?.[index];
    expect(file).toBeInstanceOf(File);
    if (!file) {
        throw new Error('Expected selected File');
    }
    return file;
}

function deferred<T>() {
    let resolveDeferred!: (value: T) => void;
    let rejectDeferred!: (error: unknown) => void;
    const promise = new Promise<T>((resolve, reject) => {
        resolveDeferred = resolve;
        rejectDeferred = reject;
    });
    return { promise, resolve: resolveDeferred, reject: rejectDeferred };
}

describe('file selection provenance', () => {
    const inputs: HTMLInputElement[] = [];

    function chooseFiles(files: File[]): void {
        vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
            inputs.push(this);
            selectFiles(this, files);
        });
    }

    beforeEach(() => {
        vi.resetAllMocks();
        inputs.length = 0;
        desktop.isDesktopRuntime.mockReturnValue(true);
        desktop.desktopOpenDialog.mockRejectedValue(new Error('native grant rejected'));
        desktop.readFileBytes.mockImplementation(() => {
            throw new Error('Browser selection must not enter native read_file_bytes');
        });
    });

    afterEach(() => {
        for (const input of inputs) {
            input.dispatchEvent(new Event('cancel'));
        }
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('returns the selected browser File bytes after a rejected native opening', async () => {
        const selected = new File([new Uint8Array([0, 255, 83, 67, 76, 10])], 'selected.scl', {
            type: 'text/plain',
            lastModified: 17,
        });
        vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
            selectFiles(this, [selected]);
        });

        const result = await pickFiles({ filters: [{ name: 'Scala', extensions: ['scl'] }] });

        expect(result).toHaveLength(1);
        const actual = result?.[0];
        expect(actual).toBe(selected);
        if (!actual) {
            throw new Error('Expected selected File');
        }
        expect(actual.type).toBe('text/plain');
        expect(actual.lastModified).toBe(17);
        expect(await readBytes(actual)).toEqual([0, 255, 83, 67, 76, 10]);
        expect(desktop.readFileBytes).not.toHaveBeenCalled();
    });

    it('keeps same-basename browser selections distinct and ordered', async () => {
        const first = new File([new Uint8Array([1, 255, 3])], 'same.wav');
        const second = new File([new Uint8Array([9, 0, 7])], 'same.wav');
        chooseFiles([first, second]);

        const result = await pickFiles({ multiple: true });

        expect(result).toHaveLength(2);
        expect(result?.[0]).toBe(first);
        expect(result?.[1]).toBe(second);
        expect(await readBytes(requireFile(result))).toEqual([1, 255, 3]);
        expect(await readBytes(requireFile(result, 1))).toEqual([9, 0, 7]);
        expect(desktop.readFileBytes).not.toHaveBeenCalled();
    });

    it('keeps overlapping fallback selections local when native rejections settle out of order', async () => {
        const firstOpening = deferred<never>();
        const secondOpening = deferred<never>();
        const firstPicker = deferred<HTMLInputElement>();
        const secondPicker = deferred<HTMLInputElement>();
        desktop.desktopOpenDialog.mockReturnValueOnce(firstOpening.promise).mockReturnValueOnce(secondOpening.promise);
        vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
            inputs.push(this);
            if (inputs.length === 1) {
                secondPicker.resolve(this);
            } else {
                firstPicker.resolve(this);
            }
        });
        const firstFile = new File([new Uint8Array([1, 2])], 'same.wav');
        const secondFile = new File([new Uint8Array([8, 9])], 'same.wav');
        const first = pickFiles();
        const second = pickFiles();

        secondOpening.reject(new Error('second native grant rejected'));
        const secondInput = await secondPicker.promise;
        firstOpening.reject(new Error('first native grant rejected'));
        const firstInput = await firstPicker.promise;
        selectFiles(firstInput, [firstFile]);
        const firstResult = await first;
        selectFiles(secondInput, [secondFile]);
        const secondResult = await second;

        expect(firstResult?.[0]).toBe(firstFile);
        expect(secondResult?.[0]).toBe(secondFile);
        expect(await readBytes(requireFile(firstResult))).toEqual([1, 2]);
        expect(await readBytes(requireFile(secondResult))).toEqual([8, 9]);
        expect(desktop.readFileBytes).not.toHaveBeenCalled();
    });

    it('preserves native paths and exact byte subviews', async () => {
        desktop.desktopOpenDialog.mockResolvedValue(['C:\\Samples\\same.wav', '/drums/same.wav']);
        desktop.readFileBytes
            .mockResolvedValueOnce(new Uint8Array([99, 1, 255, 3, 88]).subarray(1, 4))
            .mockResolvedValueOnce(new Uint8Array([66, 7, 0, 9, 55]).subarray(1, 4));
        const click = vi.spyOn(HTMLInputElement.prototype, 'click');

        const result = await pickFiles({ multiple: true });

        expect(result).toHaveLength(2);
        expect(result?.map((file) => file.name)).toEqual(['same.wav', 'same.wav']);
        expect(await readBytes(requireFile(result))).toEqual([1, 255, 3]);
        expect(await readBytes(requireFile(result, 1))).toEqual([7, 0, 9]);
        expect(desktop.readFileBytes.mock.calls).toEqual([
            [{ path: 'C:\\Samples\\same.wav' }],
            [{ path: '/drums/same.wav' }],
        ]);
        expect(click).not.toHaveBeenCalled();
    });

    it('does not fall back after a native byte-read rejection', async () => {
        desktop.desktopOpenDialog.mockResolvedValue(['/granted/first.wav', '/granted/second.wav']);
        const failure = new Error('native read denied');
        desktop.readFileBytes.mockResolvedValueOnce(new Uint8Array([1])).mockRejectedValueOnce(failure);
        const click = vi.spyOn(HTMLInputElement.prototype, 'click');

        await expect(pickFiles({ multiple: true })).rejects.toBe(failure);

        expect(desktop.readFileBytes).toHaveBeenCalledTimes(2);
        expect(click).not.toHaveBeenCalled();
    });

    it('uses the same File authority in ordinary browser runtime', async () => {
        desktop.isDesktopRuntime.mockReturnValue(false);
        const file = new File([new Uint8Array([5, 0, 255])], 'browser.wav');
        chooseFiles([file]);

        const result = await pickFiles();

        expect(result?.[0]).toBe(file);
        expect(await readBytes(requireFile(result))).toEqual([5, 0, 255]);
        expect(desktop.desktopOpenDialog).not.toHaveBeenCalled();
        expect(desktop.readFileBytes).not.toHaveBeenCalled();
    });

    it.each([null, []])('keeps native cancellation %j from opening a browser picker', async (selection) => {
        desktop.desktopOpenDialog.mockResolvedValue(selection);
        const click = vi.spyOn(HTMLInputElement.prototype, 'click');

        await expect(pickFiles()).resolves.toBeNull();

        expect(click).not.toHaveBeenCalled();
        expect(desktop.readFileBytes).not.toHaveBeenCalled();
    });

    it.each(['cancel', 'empty', 'focus'])(
        'settles rejected-opening fallback cancellation through %s',
        async (event) => {
            const opened = deferred<HTMLInputElement>();
            if (event === 'focus') {
                vi.useFakeTimers();
            }
            vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
                inputs.push(this);
                opened.resolve(this);
            });
            const pending = pickFiles();
            const input = await opened.promise;

            if (event === 'empty') {
                selectFiles(input, []);
            } else if (event === 'cancel') {
                input.dispatchEvent(new Event('cancel'));
            } else {
                window.dispatchEvent(new Event('focus'));
                await vi.advanceTimersByTimeAsync(300);
            }

            await expect(pending).resolves.toBeNull();
            expect(desktop.desktopOpenDialog).toHaveBeenCalledOnce();
            expect(desktop.readFileBytes).not.toHaveBeenCalled();
        }
    );

    it('keeps a real change ahead of focus cancellation and ignores later events after settlement', async () => {
        vi.useFakeTimers();
        const opened = deferred<HTMLInputElement>();
        vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
            inputs.push(this);
            opened.resolve(this);
        });
        const removeListener = vi.spyOn(window, 'removeEventListener');
        const file = new File([new Uint8Array([7, 8])], 'chosen.wav');
        const pending = pickFiles();
        const input = await opened.promise;
        window.dispatchEvent(new Event('focus'));
        selectFiles(input, [file]);
        const result = await pending;
        await vi.advanceTimersByTimeAsync(300);
        selectFiles(input, [new File(['late'], 'late.wav')]);
        input.dispatchEvent(new Event('cancel'));
        vi.useRealTimers();

        expect(result?.[0]).toBe(file);
        expect(await readBytes(requireFile(result))).toEqual([7, 8]);
        expect(removeListener).toHaveBeenCalledWith('focus', expect.any(Function));
        expect(desktop.readFileBytes).not.toHaveBeenCalled();
    });

    it.each([false, true])('propagates browser picker failure with desktop runtime %s', async (desktopRuntime) => {
        desktop.isDesktopRuntime.mockReturnValue(desktopRuntime);
        const failure = new Error('browser picker activation failed');
        const removeListener = vi.spyOn(window, 'removeEventListener');
        vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
            inputs.push(this);
            throw failure;
        });

        await expect(pickFiles()).rejects.toBe(failure);

        expect(desktop.readFileBytes).not.toHaveBeenCalled();
        expect(removeListener).toHaveBeenCalledWith('focus', expect.any(Function));
    });
});
