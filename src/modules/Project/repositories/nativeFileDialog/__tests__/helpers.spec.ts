import { afterEach, describe, expect, it, vi } from 'vitest';

import { openViaBrowser } from '../helpers';

function createFileList(files: File[]): FileList {
    const fileList: Record<number, File> & { length: number; item: (index: number) => File | null } = {
        length: files.length,
        item: (index: number) => files[index] ?? null,
    };
    files.forEach((file, index) => {
        fileList[index] = file;
    });
    return fileList as unknown as FileList;
}

function dispatchFileSelection(input: HTMLInputElement, files: File[]): void {
    Object.defineProperty(input, 'files', { value: createFileList(files), configurable: true });
    input.dispatchEvent(new Event('change'));
}

describe('openViaBrowser', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('resolves with the selected file names on a change event', async () => {
        vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
            dispatchFileSelection(this, [new File(['content'], 'kick.wav')]);
        });

        await expect(openViaBrowser({})).resolves.toEqual(['kick.wav']);
    });

    it('resolves null when the change event carries no files', async () => {
        vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
            dispatchFileSelection(this, []);
        });

        await expect(openViaBrowser({})).resolves.toBeNull();
    });

    it('resolves null when the dialog is cancelled', async () => {
        vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
            this.dispatchEvent(new Event('cancel'));
        });

        await expect(openViaBrowser({})).resolves.toBeNull();
    });

    it('configures multiple selection and the accept filter from the requested extensions', () => {
        let capturedInput: HTMLInputElement | undefined;
        vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
            capturedInput = this;
            this.dispatchEvent(new Event('cancel'));
        });

        void openViaBrowser({ multiple: true, filters: [{ name: 'Audio', extensions: ['wav', 'mp3'] }] });

        expect(capturedInput?.multiple).toBe(true);
        expect(capturedInput?.accept).toBe('.wav,.mp3');
    });

    it('resolves null via the focus fallback when neither change nor cancel ever fires', async () => {
        vi.useFakeTimers();
        vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);

        const pending = openViaBrowser({});
        window.dispatchEvent(new Event('focus'));
        await vi.advanceTimersByTimeAsync(300);

        await expect(pending).resolves.toBeNull();
    });
});
