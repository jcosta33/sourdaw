import { act, render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { SpectralWaterfall } from '../SpectralWaterfall';

const DISPLAY_COLS = 176;
const HISTORY_FRAMES = 128;

type RecordingCtx = {
    drawImage: ReturnType<typeof vi.fn>;
    putImageData: ReturnType<typeof vi.fn>;
    createImageData: (w: number, h: number) => ImageData;
    clearRect: () => void;
    imageSmoothingEnabled: boolean;
};

/** Minimal recording 2D context: tracks the scroll self-blit and row writes. */
function makeRecordingCtx(): RecordingCtx {
    return {
        drawImage: vi.fn(),
        putImageData: vi.fn(),
        createImageData: (w: number, h: number) => new ImageData(w, h),
        clearRect: () => {},
        imageSmoothingEnabled: false,
    };
}

/** A fake analyser that emits a non-trivial frame. */
function makeAnalyser(): AnalyserNode {
    return {
        fftSize: 512,
        frequencyBinCount: 256,
        getFloatFrequencyData: (data: Float32Array): void => {
            // -20 dB across the spectrum -> normalizes to a visible magnitude.
            data.fill(-20);
        },
    } as unknown as AnalyserNode;
}

describe('SpectralWaterfall', () => {
    let ctxs: RecordingCtx[];
    let rafCallbacks: FrameRequestCallback[];

    beforeEach(() => {
        ctxs = [];
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((id: string) => {
            if (id === '2d') {
                const ctx = makeRecordingCtx();
                ctxs.push(ctx);
                return ctx as unknown as CanvasRenderingContext2D;
            }
            return null;
        }) as typeof HTMLCanvasElement.prototype.getContext);

        rafCallbacks = [];
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
            rafCallbacks.push(cb);
            return rafCallbacks.length;
        });
        vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    const tick = (): void => {
        const pending = rafCallbacks;
        rafCallbacks = [];
        act(() => {
            for (const cb of pending) {
                cb(performance.now());
            }
        });
    };

    it('should render', () => {
        const { container } = render(<SpectralWaterfall analyser={null} />);
        expect(container.querySelector('canvas')).toBeTruthy();
    });

    it('scrolls the offscreen buffer by one row and writes a single new row per frame', () => {
        render(<SpectralWaterfall analyser={makeAnalyser()} />);

        // The offscreen 2D context is the second created (visible canvas first
        // via React ref, offscreen second inside the effect).
        const offscreen = ctxs[1]!;
        expect(offscreen).toBeDefined();

        tick(); // run one render frame

        // A self-blit shifted down by exactly one pixel performs the scroll.
        const scrollBlit = offscreen.drawImage.mock.calls.find((c) => c[1] === 0 && c[2] === 1);
        expect(scrollBlit).toBeDefined();

        // Only the newest row is painted: putImageData receives a 1-row image,
        // never the full HISTORY_FRAMES-tall buffer.
        expect(offscreen.putImageData).toHaveBeenCalled();
        for (const call of offscreen.putImageData.mock.calls) {
            const img = call[0] as ImageData;
            expect(img.height).toBe(1);
            expect(img.width).toBe(DISPLAY_COLS);
            // The whole-buffer rebuild would have been HISTORY_FRAMES tall.
            expect(img.height).not.toBe(HISTORY_FRAMES);
        }
    });

    it('does not scroll on idle frames when no analyser is connected', () => {
        render(<SpectralWaterfall analyser={null} />);
        const offscreen = ctxs[1]!;
        tick();
        // With no ingested frame there is nothing to scroll or write.
        const scrollBlit = offscreen.drawImage.mock.calls.find((c) => c[1] === 0 && c[2] === 1);
        expect(scrollBlit).toBeUndefined();
        expect(offscreen.putImageData).not.toHaveBeenCalled();
    });
});
