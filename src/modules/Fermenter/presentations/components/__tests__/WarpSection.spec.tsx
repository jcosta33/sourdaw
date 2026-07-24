import { type ReactElement } from 'react';

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { WarpSection } from '../WarpSection';

// Mock RotaryKnob so we can assert onParam routing without the real drag logic.
vi.mock('#/components/daw/RotaryKnob', () => ({
    RotaryKnob: ({ value, onChange }: { value: number; onChange: (v: number) => void }): ReactElement => (
        <button type="button" data-testid="knob" data-value={value} onClick={() => onChange(0.5)}>
            knob
        </button>
    ),
}));

function defaultProps(overrides: Record<string, unknown> = {}) {
    return {
        warpMode: 0,
        warpAmount: 0,
        audioModRate: 0,
        audioModDepth: 0,
        audioModTarget: 0,
        onParam: vi.fn(),
        ...overrides,
    };
}

describe('WarpSection', () => {
    describe('audio-rate readout formatting (3-tier branching)', () => {
        it('formats sub-20Hz rates with one decimal', () => {
            render(<WarpSection {...defaultProps({ audioModTarget: 1, audioModRate: 8 })} />);
            expect(screen.getByText('8.0Hz')).toBeTruthy();
        });

        it('formats 20–999Hz rates as rounded whole Hz', () => {
            render(<WarpSection {...defaultProps({ audioModTarget: 1, audioModRate: 220 })} />);
            expect(screen.getByText('220Hz')).toBeTruthy();
        });

        it('formats ≥1000Hz rates as kHz with one decimal', () => {
            render(<WarpSection {...defaultProps({ audioModTarget: 1, audioModRate: 2500 })} />);
            expect(screen.getByText('2.5kHz')).toBeTruthy();
        });
    });

    describe('warp-mode selection routing', () => {
        it('routes a warp-mode chip click to onParam("warpMode", index)', () => {
            const onParam = vi.fn();
            render(<WarpSection {...defaultProps({ onParam })} />);
            // WARP_MODE_NAMES = ['Off','Sync','Quantize','Squeeze','Bend','Formant','Fold']
            fireEvent.click(screen.getByText('Sync'));
            expect(onParam).toHaveBeenLastCalledWith('warpMode', 1);
            fireEvent.click(screen.getByText('Fold'));
            expect(onParam).toHaveBeenLastCalledWith('warpMode', 6);
        });
    });

    describe('warp amount knob conditional gate', () => {
        it('does not expose the Amount control when warpMode is Off(0)', () => {
            render(<WarpSection {...defaultProps({ warpMode: 0 })} />);
            expect(screen.queryByText('Amount')).toBeNull();
        });

        it('exposes the Amount control and routes it to onParam("warpAmount") when warpMode > 0', () => {
            const onParam = vi.fn();
            render(<WarpSection {...defaultProps({ warpMode: 3, onParam })} />);
            // Amount is the only knob when audioModTarget is Off
            const amountKnob = screen.getByTestId('knob');
            fireEvent.click(amountKnob);
            expect(onParam).toHaveBeenCalledWith('warpAmount', 0.5);
        });
    });

    describe('audio-rate mod target gate + routing', () => {
        it('routes an audio-mod-target chip click to onParam("audioModTarget", index)', () => {
            const onParam = vi.fn();
            render(<WarpSection {...defaultProps({ onParam })} />);
            // AUDIO_MOD_TARGET_NAMES = ['Off','Pitch (FM)','Amp (AM)','Filter']
            fireEvent.click(screen.getByText('Pitch (FM)'));
            expect(onParam).toHaveBeenLastCalledWith('audioModTarget', 1);
            fireEvent.click(screen.getByText('Filter'));
            expect(onParam).toHaveBeenLastCalledWith('audioModTarget', 3);
        });

        it('does not expose Rate/Depth controls when audioModTarget is Off(0)', () => {
            render(<WarpSection {...defaultProps({ audioModTarget: 0 })} />);
            expect(screen.queryByText('Rate')).toBeNull();
            expect(screen.queryByText('Depth')).toBeNull();
        });

        it('exposes Rate + Depth controls and routes them when audioModTarget > 0', () => {
            const onParam = vi.fn();
            render(<WarpSection {...defaultProps({ audioModTarget: 1, onParam })} />);
            const knobs = screen.getAllByTestId('knob');
            expect(knobs.length).toBe(2);
            fireEvent.click(knobs[0]!);
            expect(onParam).toHaveBeenCalledWith('audioModRate', 0.5);
            fireEvent.click(knobs[1]!);
            expect(onParam).toHaveBeenCalledWith('audioModDepth', 0.5);
        });
    });
});
