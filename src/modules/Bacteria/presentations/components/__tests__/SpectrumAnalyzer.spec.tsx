import { render } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

import { SpectrumAnalyzer } from '../SpectrumAnalyzer';

type GetContext2d = (contextId: '2d', options?: CanvasRenderingContext2DSettings) => CanvasRenderingContext2D | null;

function spyOnGetContext(ctx: CanvasRenderingContext2D): void {
    const proto: { getContext: GetContext2d } = HTMLCanvasElement.prototype;
    vi.spyOn(proto, 'getContext').mockReturnValue(ctx);
}

describe('SpectrumAnalyzer', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should render', () => {
        const { container } = render(<SpectrumAnalyzer width={200} height={60} />);
        expect(container.querySelector('canvas')).toBeTruthy();
    });

    // Regression: without an FFT source, the analyzer used to fabricate a
    // spectrum from `Math.random()` and render it as a live read. There is no
    // FFT telemetry pipeline for Bacteria, so the absent-data path must render
    // an honest idle state and never invent signal.
    it('does not fabricate spectrum data when no fftData is provided', () => {
        const randomSpy = vi.spyOn(Math, 'random');

        render(<SpectrumAnalyzer width={200} height={60} showHeatmap />);

        expect(randomSpy).not.toHaveBeenCalled();
    });

    it('paints an idle label when no fftData is provided', () => {
        const ctx = document.createElement('canvas').getContext('2d')!;
        const fillTextSpy = vi.spyOn(ctx, 'fillText');
        spyOnGetContext(ctx);

        render(<SpectrumAnalyzer width={200} height={60} />);

        expect(fillTextSpy).toHaveBeenCalledWith('No spectrum signal', expect.any(Number), expect.any(Number));
    });

    it('draws spectrum bars (not the idle label) when fftData is present', () => {
        const ctx = document.createElement('canvas').getContext('2d')!;
        const fillTextSpy = vi.spyOn(ctx, 'fillText');
        const fillRectSpy = vi.spyOn(ctx, 'fillRect');
        spyOnGetContext(ctx);

        const fftData = new Float32Array(256).fill(0.5);
        render(<SpectrumAnalyzer width={200} height={60} fftData={fftData} />);

        expect(fillTextSpy).not.toHaveBeenCalledWith('No spectrum signal', expect.any(Number), expect.any(Number));
        // The bar/grid fills still run on the real-data path.
        expect(fillRectSpy).toHaveBeenCalled();
    });
});
