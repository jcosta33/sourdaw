import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('#/utils/UI/resolveToken', () => ({
    resolveToken: vi.fn(() => '#d97706'),
}));

import { CompressorCurve } from '../CompressorCurve';

beforeEach(() => {
    vi.clearAllMocks();
});

describe('CompressorCurve — canvas structure', () => {
    it('renders a canvas with role="img"', () => {
        render(<CompressorCurve threshold={-20} ratio={4} knee={6} makeup={0} />);
        expect(screen.getByRole('img')).toBeInTheDocument();
    });

    it('aria-label is "Compressor transfer curve"', () => {
        render(<CompressorCurve threshold={-20} ratio={4} knee={6} makeup={0} />);
        expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'Compressor transfer curve');
    });

    it('default width/height are 120', () => {
        const { container } = render(<CompressorCurve threshold={-20} ratio={4} knee={6} makeup={0} />);
        const canvas = container.querySelector('canvas')!;
        expect(canvas.getAttribute('width')).toBe('120');
        expect(canvas.getAttribute('height')).toBe('120');
    });
});

describe('CompressorCurve — interactive mode', () => {
    it('sets cursor to grab when interactive', () => {
        const { container } = render(
            <CompressorCurve threshold={-20} ratio={4} knee={6} makeup={0} onParamChange={vi.fn()} />
        );
        expect(container.querySelector('canvas')!.style.cursor).toBe('grab');
    });

    it('does not set cursor when not interactive', () => {
        const { container } = render(<CompressorCurve threshold={-20} ratio={4} knee={6} makeup={0} />);
        expect(container.querySelector('canvas')!.style.cursor).toBe('');
    });

    it('calls onParamChange with comp-threshold when dragging', () => {
        const onParamChange = vi.fn();
        const { container } = render(
            <CompressorCurve threshold={-20} ratio={4} knee={6} makeup={0} onParamChange={onParamChange} />
        );
        const canvas = container.querySelector('canvas')!;
        canvas.getBoundingClientRect = () => ({
            left: 0,
            top: 0,
            width: 120,
            height: 120,
            right: 120,
            bottom: 120,
            x: 0,
            y: 0,
            toJSON: () => {},
        });
        fireEvent.pointerDown(canvas, { pointerId: 1 });
        fireEvent.pointerMove(canvas, { clientY: 10, pointerId: 1 });
        expect(onParamChange).toHaveBeenCalledTimes(1);
        expect(onParamChange.mock.calls[0]?.[0]).toBe('comp-threshold');
    });

    it('does not fire onParamChange on move without down', () => {
        const onParamChange = vi.fn();
        const { container } = render(
            <CompressorCurve threshold={-20} ratio={4} knee={6} makeup={0} onParamChange={onParamChange} />
        );
        fireEvent.pointerMove(container.querySelector('canvas')!, { clientY: 10 });
        expect(onParamChange).not.toHaveBeenCalled();
    });

    it('stops after pointerUp', () => {
        const onParamChange = vi.fn();
        const { container } = render(
            <CompressorCurve threshold={-20} ratio={4} knee={6} makeup={0} onParamChange={onParamChange} />
        );
        const canvas = container.querySelector('canvas')!;
        canvas.getBoundingClientRect = () => ({
            left: 0,
            top: 0,
            width: 120,
            height: 120,
            right: 120,
            bottom: 120,
            x: 0,
            y: 0,
            toJSON: () => {},
        });
        fireEvent.pointerDown(canvas, { pointerId: 1 });
        fireEvent.pointerMove(canvas, { clientY: 20, pointerId: 1 });
        fireEvent.pointerUp(canvas, { pointerId: 1 });
        fireEvent.pointerMove(canvas, { clientY: 30, pointerId: 1 });
        expect(onParamChange).toHaveBeenCalledTimes(1);
    });
});
