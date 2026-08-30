import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { downloadAudioWav } from '../downloadAudioWav';

describe('downloadAudioWav', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        global.URL.createObjectURL = vi.fn(() => 'blob:retained-render');
        global.URL.revokeObjectURL = vi.fn();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('downloads the exact WAV bytes through an attached anchor and defers cleanup until a later task', async () => {
        const createElement = vi.spyOn(document, 'createElement');
        const appendChild = vi.spyOn(document.body, 'appendChild');
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        const bytes = new Uint8Array([82, 73, 70, 70]);

        downloadAudioWav(bytes.buffer, 'retained-chorus.wav');

        expect(createElement).toHaveBeenCalledExactlyOnceWith('a');
        const anchor = createElement.mock.results[0]?.value;
        if (!(anchor instanceof HTMLAnchorElement)) {
            throw new Error('Expected an HTML anchor download element.');
        }
        const blob = vi.mocked(URL.createObjectURL).mock.calls[0]?.[0];
        if (!(blob instanceof Blob)) {
            throw new Error('Expected exact WAV bytes to be wrapped in a Blob.');
        }
        expect(blob.type).toBe('audio/wav');
        expect(blob.size).toBe(bytes.byteLength);
        expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
        expect(anchor.href).toBe('blob:retained-render');
        expect(anchor.download).toBe('retained-chorus.wav');
        expect(appendChild).toHaveBeenCalledExactlyOnceWith(anchor);
        expect(click).toHaveBeenCalledOnce();
        expect(appendChild.mock.invocationCallOrder[0]).toBeLessThan(click.mock.invocationCallOrder[0]!);
        expect(anchor.parentNode).toBe(document.body);
        expect(URL.revokeObjectURL).not.toHaveBeenCalled();

        vi.runAllTimers();

        expect(anchor.parentNode).toBeNull();
        expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:retained-render');
    });
});
