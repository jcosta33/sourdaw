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
        expect(fillRectSpy).toHaveBeenCalled();
    });
});

describe('SpectrumAnalyzer — canvas attributes', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('sizes the canvas to the provided width and height', () => {
        const { container } = render(<SpectrumAnalyzer width={300} height={120} />);
        const canvas = container.querySelector('canvas');
        expect(canvas?.width).toBe(300);
        expect(canvas?.height).toBe(120);
    });

    it('renders with default props without crashing', () => {
        const { container } = render(<SpectrumAnalyzer width={100} height={50} />);
        expect(container.querySelector('canvas')).toBeTruthy();
    });
});

describe('SpectrumAnalyzer — crossover overlay', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('draws crossover lines when crossoverFreqs and bandCount are provided', () => {
        const ctx = document.createElement('canvas').getContext('2d')!;
        const strokeSpy = vi.spyOn(ctx, 'stroke');
        spyOnGetContext(ctx);
        render(<SpectrumAnalyzer width={200} height={60} crossoverFreqs={[500, 2000]} bandCount={3} />);
        // Crossover lines use setLineDash + stroke; at least 2 crossover lines should be drawn
        expect(strokeSpy.mock.calls.length).toBeGreaterThan(2);
    });

    it('does not draw crossover lines when bandCount is 1', () => {
        const ctx = document.createElement('canvas').getContext('2d')!;
        const setLineDashSpy = vi.spyOn(ctx, 'setLineDash');
        spyOnGetContext(ctx);
        render(<SpectrumAnalyzer width={200} height={60} crossoverFreqs={[500]} bandCount={1} />);
        // Crossover lines use setLineDash; with bandCount=1, no crossover lines should be drawn
        const crossoverDashCalls = setLineDashSpy.mock.calls.filter((call) => {
            const arg = call[0];
            return Array.isArray(arg) && arg.length === 2;
        });
        expect(crossoverDashCalls.length).toBe(0);
    });
});
