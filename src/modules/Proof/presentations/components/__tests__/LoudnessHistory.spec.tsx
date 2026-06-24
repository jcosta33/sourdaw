import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { LoudnessHistory } from '../LoudnessHistory';

// Mirror of the component's dB→y mapping (MIN_DB=-60, MAX_DB=0).
const yForDb = (db: number, height: number): number => ((db - 0) / (-60 - 0)) * height;

const HIGHLIGHT = 'rgba(255,255,255,0.06)';
const FAINT = 'rgba(255,255,255,0.035)';

type GridLine = { strokeStyle: string; y: number };

/**
 * Record every grid line the component draws by spying on the 2D context.
 * Grid lines are the horizontal strokes set with one of the two grid colors,
 * captured as (strokeStyle, y) at their `moveTo` call.
 */
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

        // Exactly one gridline is highlighted, and it sits at the -24 dB position.
        expect(highlighted).toHaveLength(1);
        expect(highlighted[0]!.y).toBeCloseTo(yForDb(-24, height), 5);
    });

    it('does not highlight any gridline at the -14 dB position', () => {
        const height = 48;
        const lines = captureGridLines(height);

        const at14 = lines.find((line) => Math.abs(line.y - yForDb(-14, height)) < 1e-6);

        // -14 is not one of the iterated gridlines, so no line should be drawn there at all.
        expect(at14).toBeUndefined();
    });
});
