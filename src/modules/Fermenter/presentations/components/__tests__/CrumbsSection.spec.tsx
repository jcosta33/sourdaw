import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { CrumbsSection } from '../CrumbsSection';

function defaultProps(overrides: Record<string, unknown> = {}) {
    return {
        mode: 0,
        start: 0,
        end: 1,
        onParam: vi.fn(),
        ...overrides,
    };
}

describe('CrumbsSection', () => {
    describe('playback mode selection', () => {
        // MODE_NAMES = ['One-Shot', 'Loop', 'Ping-Pong']
        it('routes a mode chip click to onParam with samplerMode and the index', () => {
            const onParam = vi.fn();
            render(<CrumbsSection {...defaultProps({ onParam })} />);
            fireEvent.click(screen.getByText('One-Shot'));
            expect(onParam).toHaveBeenLastCalledWith('samplerMode', 0);
            fireEvent.click(screen.getByText('Loop'));
            expect(onParam).toHaveBeenLastCalledWith('samplerMode', 1);
            fireEvent.click(screen.getByText('Ping-Pong'));
            expect(onParam).toHaveBeenLastCalledWith('samplerMode', 2);
        });
    });

    describe('readout formatting', () => {
        it('formats the start point as a whole-number percentage', () => {
            render(<CrumbsSection {...defaultProps({ start: 0.333 })} />);
            expect(screen.getByText('33%')).toBeInTheDocument();
        });

        it('formats the end point as a whole-number percentage', () => {
            render(<CrumbsSection {...defaultProps({ end: 0.751 })} />);
            expect(screen.getByText('75%')).toBeInTheDocument();
        });
    });

    describe('knob routing', () => {
        it('emits samplerStart when the Start slider is incremented', () => {
            const onParam = vi.fn();
            render(<CrumbsSection {...defaultProps({ onParam })} />);
            const startSlider = screen.getAllByRole('slider')[0]!;
            startSlider.focus();
            fireEvent.keyDown(startSlider, { key: 'ArrowUp' });
            expect(onParam).toHaveBeenCalledWith('samplerStart', expect.any(Number));
        });

        it('emits samplerEnd when the End slider is decremented from max', () => {
            const onParam = vi.fn();
            // end default is 1.0 (the max), so ArrowUp is a no-op; use ArrowDown.
            render(<CrumbsSection {...defaultProps({ end: 1, onParam })} />);
            const endSlider = screen.getAllByRole('slider')[1]!;
            endSlider.focus();
            fireEvent.keyDown(endSlider, { key: 'ArrowDown' });
            expect(onParam).toHaveBeenCalledWith('samplerEnd', expect.any(Number));
        });
    });
});
