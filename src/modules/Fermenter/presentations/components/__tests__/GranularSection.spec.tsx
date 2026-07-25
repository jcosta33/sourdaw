import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { GranularSection } from '../GranularSection';

function defaultProps(overrides: Record<string, unknown> = {}) {
    return {
        density: 20,
        size: 50,
        position: 0,
        spray: 0.1,
        pitchVar: 0,
        panSpread: 0.5,
        onParam: vi.fn(),
        ...overrides,
    };
}

describe('GranularSection', () => {
    describe('readout formatting', () => {
        it('rounds the grain density to whole grains/sec', () => {
            render(<GranularSection {...defaultProps({ density: 23.4 })} />);
            expect(screen.getByText('23g/s')).toBeInTheDocument();
        });

        it('rounds the grain size to whole milliseconds', () => {
            render(<GranularSection {...defaultProps({ size: 137.8 })} />);
            expect(screen.getByText('138ms')).toBeInTheDocument();
        });

        it('formats the pitch variation as semitones with one decimal', () => {
            render(<GranularSection {...defaultProps({ pitchVar: 3.25 })} />);
            expect(screen.getByText('3.3st')).toBeInTheDocument();
        });

        it('shows zero density and zero pitch at minimum values', () => {
            render(<GranularSection {...defaultProps({ density: 0, pitchVar: 0 })} />);
            expect(screen.getByText('0g/s')).toBeInTheDocument();
            expect(screen.getByText('0.0st')).toBeInTheDocument();
        });
    });

    describe('section labels', () => {
        it('renders all six parameter labels', () => {
            render(<GranularSection {...defaultProps()} />);
            expect(screen.getByText('Density')).toBeInTheDocument();
            expect(screen.getByText('Size')).toBeInTheDocument();
            expect(screen.getByText('Position')).toBeInTheDocument();
            expect(screen.getByText('Spray')).toBeInTheDocument();
            expect(screen.getByText('Pitch ±')).toBeInTheDocument();
            expect(screen.getByText('Spread')).toBeInTheDocument();
        });

        it('renders the section header', () => {
            render(<GranularSection {...defaultProps()} />);
            expect(screen.getByText('Grain Cloud')).toBeInTheDocument();
        });
    });

    describe('knob rendering and interaction', () => {
        it('renders six grain-parameter sliders', () => {
            render(<GranularSection {...defaultProps({ density: 42, size: 200, pitchVar: 5 })} />);
            const sliders = screen.getAllByRole('slider');
            expect(sliders).toHaveLength(6);
        });

        it('emits grainDensity when the first (density) slider is incremented', () => {
            const onParam = vi.fn();
            render(<GranularSection {...defaultProps({ onParam })} />);
            const densitySlider = screen.getAllByRole('slider')[0]!;
            densitySlider.focus();
            fireEvent.keyDown(densitySlider, { key: 'ArrowUp' });
            expect(onParam).toHaveBeenCalledWith('grainDensity', expect.any(Number));
        });

        it('emits grainSize when the second (size) slider is incremented', () => {
            const onParam = vi.fn();
            render(<GranularSection {...defaultProps({ onParam })} />);
            const sizeSlider = screen.getAllByRole('slider')[1]!;
            sizeSlider.focus();
            fireEvent.keyDown(sizeSlider, { key: 'ArrowUp' });
            expect(onParam).toHaveBeenCalledWith('grainSize', expect.any(Number));
        });

        it('emits grainPosition when the third (position) slider is incremented', () => {
            const onParam = vi.fn();
            render(<GranularSection {...defaultProps({ onParam })} />);
            const positionSlider = screen.getAllByRole('slider')[2]!;
            positionSlider.focus();
            fireEvent.keyDown(positionSlider, { key: 'ArrowUp' });
            expect(onParam).toHaveBeenCalledWith('grainPosition', expect.any(Number));
        });

        it('emits grainSpray when the fourth (spray) slider is incremented', () => {
            const onParam = vi.fn();
            render(<GranularSection {...defaultProps({ onParam })} />);
            const spraySlider = screen.getAllByRole('slider')[3]!;
            spraySlider.focus();
            fireEvent.keyDown(spraySlider, { key: 'ArrowUp' });
            expect(onParam).toHaveBeenCalledWith('grainSpray', expect.any(Number));
        });

        it('emits grainPitchVar when the fifth (pitch var) slider is incremented', () => {
            const onParam = vi.fn();
            render(<GranularSection {...defaultProps({ onParam })} />);
            const pitchSlider = screen.getAllByRole('slider')[4]!;
            pitchSlider.focus();
            fireEvent.keyDown(pitchSlider, { key: 'ArrowUp' });
            expect(onParam).toHaveBeenCalledWith('grainPitchVar', expect.any(Number));
        });

        it('emits grainPanSpread when the sixth (spread) slider is incremented', () => {
            const onParam = vi.fn();
            render(<GranularSection {...defaultProps({ onParam })} />);
            const spreadSlider = screen.getAllByRole('slider')[5]!;
            spreadSlider.focus();
            fireEvent.keyDown(spreadSlider, { key: 'ArrowUp' });
            expect(onParam).toHaveBeenCalledWith('grainPanSpread', expect.any(Number));
        });
    });
});
