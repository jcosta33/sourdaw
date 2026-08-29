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

    it('downloads the WAV through an attached link and defers cleanup until a later task', () => {
        const anchor = document.createElement('a');
        vi.spyOn(document, 'createElement').mockReturnValue(anchor);
        let parentAtClick: Node | null = null;
        const click = vi.spyOn(anchor, 'click').mockImplementation(() => {
            parentAtClick = anchor.parentNode;
        });

        downloadAudioWav(new Uint8Array([82, 73, 70, 70]).buffer, 'retained-chorus.wav');

        expect(URL.createObjectURL).toHaveBeenCalledWith(expect.objectContaining({ type: 'audio/wav' }));
        expect(anchor.href).toBe('blob:retained-render');
        expect(anchor.download).toBe('retained-chorus.wav');
        expect(parentAtClick).toBe(document.body);
        expect(click).toHaveBeenCalledOnce();
        expect(anchor.parentNode).toBe(document.body);
        expect(URL.revokeObjectURL).not.toHaveBeenCalled();

        vi.runAllTimers();

        expect(anchor.parentNode).toBeNull();
        expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:retained-render');
    });
});
