import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { ModulationSection } from '../ModulationSection';

function defaultProps(overrides: Record<string, unknown> = {}) {
    return {
        msegToFilter: 0,
        seqRate: 4,
        seqToPitch: 0,
        onParam: vi.fn(),
        ...overrides,
    };
}

describe('ModulationSection', () => {
    describe('readout formatting', () => {
        it('formats the step-sequencer rate with one decimal in Hz', () => {
            render(<ModulationSection {...defaultProps({ seqRate: 7.25 })} />);
            expect(screen.getByText('7.3Hz')).toBeInTheDocument();
        });
    });

    describe('knob routing', () => {
        it('emits msegToFilter when the MSEG→Filter slider is incremented', () => {
            const onParam = vi.fn();
            render(<ModulationSection {...defaultProps({ onParam })} />);
            const sliders = screen.getAllByRole('slider');
            // Order: msegToFilter(0), seqRate(1), seqToPitch(2)
            sliders[0]!.focus();
            fireEvent.keyDown(sliders[0]!, { key: 'ArrowUp' });
            expect(onParam).toHaveBeenCalledWith('msegToFilter', expect.any(Number));
        });

        it('emits seqRate when the Step Rate slider is incremented', () => {
            const onParam = vi.fn();
            render(<ModulationSection {...defaultProps({ onParam })} />);
            const sliders = screen.getAllByRole('slider');
            sliders[1]!.focus();
            fireEvent.keyDown(sliders[1]!, { key: 'ArrowUp' });
            expect(onParam).toHaveBeenCalledWith('seqRate', expect.any(Number));
        });

        it('emits seqToPitch when the Step→Pitch slider is incremented', () => {
            const onParam = vi.fn();
            render(<ModulationSection {...defaultProps({ onParam })} />);
            const sliders = screen.getAllByRole('slider');
            sliders[2]!.focus();
            fireEvent.keyDown(sliders[2]!, { key: 'ArrowUp' });
            expect(onParam).toHaveBeenCalledWith('seqToPitch', expect.any(Number));
        });
    });
});
