import { afterEach, describe, expect, it, vi } from 'vitest';

import { openViaBrowser } from '../helpers';

function dispatchFileSelection(input: HTMLInputElement, files: File[]): void {
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    input.dispatchEvent(new Event('change'));
}

describe('openViaBrowser', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('retains the selected File objects on a change event', async () => {
        const file = new File(['content'], 'kick.wav');
        vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
            dispatchFileSelection(this, [file]);
        });

        const selected = await openViaBrowser({});
        expect(selected).toHaveLength(1);
        expect(selected?.[0]).toBe(file);
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

    it('configures multiple selection and the accept filter from the requested extensions', async () => {
        let capturedInput: HTMLInputElement | undefined;
        vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
            capturedInput = this;
            this.dispatchEvent(new Event('cancel'));
        });

        await expect(
            openViaBrowser({ multiple: true, filters: [{ name: 'Audio', extensions: ['wav', 'mp3'] }] })
        ).resolves.toBeNull();

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
