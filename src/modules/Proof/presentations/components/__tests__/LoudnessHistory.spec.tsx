import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { LoudnessHistory } from '../LoudnessHistory';

const yForDb = (db: number, height: number): number => ((db - 0) / (-60 - 0)) * height;

const HIGHLIGHT = 'rgba(255,255,255,0.06)';
const FAINT = 'rgba(255,255,255,0.035)';

type GridLine = { strokeStyle: string; y: number };

const captureGridLines = (height: number): GridLine[] => {
    const lines: GridLine[] = [];
    const original = HTMLCanvasElement.prototype.getContext;

    let strokeStyle = '';
    const ctx = {
        get strokeStyle(): string {
            return strokeStyle;
        },
        set strokeStyle(value: string) {
            strokeStyle = value;
        },
        fillStyle: '',
        lineWidth: 1,
        font: '',
        textAlign: 'start',
        shadowColor: '',
        shadowBlur: 0,
        canvas: {} as HTMLCanvasElement,
        scale: (): void => {},
        clearRect: (): void => {},
        fillRect: (): void => {},
        fillText: (): void => {},
        beginPath: (): void => {},
        closePath: (): void => {},
        moveTo: (_x: number, y: number): void => {
            if (strokeStyle === HIGHLIGHT || strokeStyle === FAINT) {
                lines.push({ strokeStyle, y });
            }
        },
        lineTo: (): void => {},
        stroke: (): void => {},
        fill: (): void => {},
        save: (): void => {},
        restore: (): void => {},
        setLineDash: (): void => {},
        createLinearGradient: () => ({ addColorStop: (): void => {} }),
    } as unknown as CanvasRenderingContext2D;

    // @ts-expect-error — narrow override for the '2d' path only
    HTMLCanvasElement.prototype.getContext = function getContext(this: HTMLCanvasElement, id: string) {
        if (id === '2d') {
            (ctx as { canvas: HTMLCanvasElement }).canvas = this;
            return ctx;
        }
        return null;
    };

    try {
        render(
            <LoudnessHistory momentaryLufs={-12} targetLufs={-14} integratedLufs={-13} width={200} height={height} />
        );
    } finally {
        HTMLCanvasElement.prototype.getContext = original;
    }

    return lines;
};

describe('LoudnessHistory', () => {
    it('should render', () => {
        const { container } = render(
            <LoudnessHistory momentaryLufs={-12} targetLufs={-14} integratedLufs={-13} width={200} height={48} />
        );
        expect(container.querySelector('canvas')).toBeTruthy();
    });

    it('highlights exactly the -24 dB gridline (no spurious highlight)', () => {
        const height = 48;
        const lines = captureGridLines(height);
        const highlighted = lines.filter((line) => line.strokeStyle === HIGHLIGHT);
        expect(highlighted).toHaveLength(1);
        expect(highlighted[0]!.y).toBeCloseTo(yForDb(-24, height), 5);
    });

    it('does not highlight any gridline at the -14 dB position', () => {
        const height = 48;
        const lines = captureGridLines(height);
        const at14 = lines.find((line) => Math.abs(line.y - yForDb(-14, height)) < 1e-6);
        expect(at14).toBeUndefined();
    });
});

describe('LoudnessHistory — canvas attributes', () => {
    it('renders with aria-label', () => {
        const { container } = render(
            <LoudnessHistory momentaryLufs={-12} targetLufs={-14} integratedLufs={-13} width={200} height={48} />
        );
        const canvas = container.querySelector('canvas');
        expect(canvas?.getAttribute('aria-label')).toBe('Loudness history graph');
    });

    it('applies width and height to the canvas style', () => {
        const { container } = render(
            <LoudnessHistory momentaryLufs={-12} targetLufs={-14} integratedLufs={-13} width={300} height={80} />
        );
        const canvas = container.querySelector('canvas');
        expect(canvas?.getAttribute('style')).toContain('width: 300px');
        expect(canvas?.getAttribute('style')).toContain('height: 80px');
    });
});

describe('LoudnessHistory — grid line coverage', () => {
    it('draws gridlines at all 6 dB reference levels', () => {
        const height = 60;
        const lines = captureGridLines(height);
        // 6 gridlines at -6, -12, -18, -24, -36, -48
        expect(lines.length).toBe(6);
        for (const db of [-6, -12, -18, -24, -36, -48]) {
            const expectedY = yForDb(db, height);
            expect(lines.some((l) => Math.abs(l.y - expectedY) < 1e-5)).toBe(true);
        }
    });
});
