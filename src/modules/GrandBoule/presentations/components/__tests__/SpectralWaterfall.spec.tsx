import { act, render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { SpectralWaterfall } from '../SpectralWaterfall';

const DISPLAY_COLS = 176;

type RecordingCtx = {
    drawImage: ReturnType<typeof vi.fn>;
    putImageData: ReturnType<typeof vi.fn>;
    createImageData: (w: number, h: number) => ImageData;
    clearRect: () => void;
    imageSmoothingEnabled: boolean;
};

function makeRecordingCtx(): RecordingCtx {
    return {
        drawImage: vi.fn(),
        putImageData: vi.fn(),
        createImageData: (w: number, h: number) => new ImageData(w, h),
        clearRect: () => {},
        imageSmoothingEnabled: false,
    };
}

function makeAnalyser(): AnalyserNode {
    return {
        fftSize: 512,
        frequencyBinCount: 256,
        getFloatFrequencyData: (data: Float32Array): void => {
            data.fill(-20);
        },
    } as unknown as AnalyserNode;
}

function makeRampAnalyser(): AnalyserNode {
    return {
        fftSize: 512,
        frequencyBinCount: 256,
        getFloatFrequencyData: (data: Float32Array): void => {
            for (let i = 0; i < data.length; i += 1) {
                data[i] = -100 + (i / data.length) * 80;
            }
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
        const offscreen = ctxs[1]!;
        expect(offscreen).toBeDefined();
        tick();
        const scrollBlit = offscreen.drawImage.mock.calls.find((c) => c[1] === 0 && c[2] === 1);
        expect(scrollBlit).toBeDefined();
        expect(offscreen.putImageData).toHaveBeenCalled();
        for (const call of offscreen.putImageData.mock.calls) {
            const img = call[0] as ImageData;
            expect(img.height).toBe(1);
            expect(img.width).toBe(DISPLAY_COLS);
        }
    });

    it('does not scroll on idle frames when no analyser is connected', () => {
        render(<SpectralWaterfall analyser={null} />);
        const offscreen = ctxs[1]!;
        tick();
        const scrollBlit = offscreen.drawImage.mock.calls.find((c) => c[1] === 0 && c[2] === 1);
        expect(scrollBlit).toBeUndefined();
        expect(offscreen.putImageData).not.toHaveBeenCalled();
    });

    const paintRowAt = (rate: number): Uint8ClampedArray => {
        render(<SpectralWaterfall analyser={makeRampAnalyser()} sampleRate={rate} />);
        const offscreen = ctxs[1]!;
        tick();
        const lastPaint = offscreen.putImageData.mock.calls.at(-1);
        const img = lastPaint![0] as ImageData;
        return img.data;
    };

    it('scales the frequency-to-column mapping by the provided sample rate', () => {
        const rowAt48k = Uint8ClampedArray.from(paintRowAt(48000));
        ctxs = [];
        rafCallbacks = [];
        const rowAt44k = Uint8ClampedArray.from(paintRowAt(44100));
        expect(rowAt48k.length).toBe(rowAt44k.length);
        const differs = rowAt48k.some((value, index) => value !== rowAt44k[index]);
        expect(differs).toBe(true);
    });
});

describe('SpectralWaterfall — canvas attributes', () => {
    beforeEach(() => {
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((id: string) => {
            if (id === '2d') {
                return makeRecordingCtx() as unknown as CanvasRenderingContext2D;
            }
            return null;
        }) as typeof HTMLCanvasElement.prototype.getContext);
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
        vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('renders canvas with aria-label', () => {
        const { container } = render(<SpectralWaterfall analyser={null} />);
        const canvas = container.querySelector('canvas');
        expect(canvas?.getAttribute('aria-label')).toBe('Grand Boule spectral waterfall');
    });

    it('applies the className prop to the container div', () => {
        const { container } = render(<SpectralWaterfall analyser={null} className="custom-waterfall-class" />);
        const wrapper = container.querySelector('div');
        expect(wrapper?.getAttribute('class')).toContain('custom-waterfall-class');
    });

    it('renders without an analyser (idle state)', () => {
        const { container } = render(<SpectralWaterfall analyser={null} />);
        // Canvas exists but no data is drawn — the component must not crash
        expect(container.querySelector('canvas')).toBeTruthy();
    });
});

describe('SpectralWaterfall — multiple frames', () => {
    let localCtxs: RecordingCtx[];
    let localRafs: FrameRequestCallback[];

    beforeEach(() => {
        localCtxs = [];
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((id: string) => {
            if (id === '2d') {
                const ctx = makeRecordingCtx();
                localCtxs.push(ctx);
                return ctx as unknown as CanvasRenderingContext2D;
            }
            return null;
        }) as typeof HTMLCanvasElement.prototype.getContext);

        localRafs = [];
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
            localRafs.push(cb);
            return localRafs.length;
        });
        vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    /**
     * Drains exactly the frames queued so far.
     *
     * The component re-arms itself — the last thing `render` does is
     * `requestAnimationFrame(render)` — so the stub pushes a new callback onto
     * `localRafs` while it is being drained. Iterating `localRafs` directly
     * makes the loop feed itself: `for…of` re-reads `length` on every step, so
     * each callback appends the next one and the loop never reaches the end.
     * Snapshotting the queue and resetting it before running anything is what
     * bounds a drain to one frame.
     */
    const tickLocal = (): void => {
        const pending = localRafs;
        localRafs = [];
        act(() => {
            for (const cb of pending) {
                cb(performance.now());
            }
        });
    };

    it('ingests multiple frames advancing the history ring', () => {
        render(<SpectralWaterfall analyser={makeAnalyser()} />);
        const offscreen = localCtxs[1]!;

        tickLocal();
        tickLocal();

        // One ingested frame paints exactly one row, so two frames paint two.
        // An exact count is also the regression guard for the drain above: a
        // self-feeding loop would run until the worker's heap is exhausted.
        expect(offscreen.putImageData.mock.calls.length).toBe(2);
    });
});
