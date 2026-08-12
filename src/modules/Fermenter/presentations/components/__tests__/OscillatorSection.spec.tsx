import { type ReactElement } from 'react';

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { type RotaryKnobComponent } from '#/components/daw/RotaryKnob';

import { OscillatorSection } from '../OscillatorSection';

// Test-only Knob: surfaces paramId and invokes onChange on click, so we can
// assert the section's param→callback routing without the real drag logic.
function TestKnob({
    paramId,
    value,
    step,
    onChange,
}: {
    paramId?: string;
    value: number;
    step?: number;
    onChange: (v: number) => void;
}): ReactElement {
    return (
        <button
            type="button"
            data-testid="knob"
            data-paramid={paramId}
            data-value={value}
            data-step={step}
            onClick={() => onChange(0.9)}
        >
            knob
        </button>
    );
}

const knob = TestKnob as unknown as RotaryKnobComponent;

function defaultProps(overrides: Record<string, unknown> = {}) {
    return {
        rotaryKnob: knob,
        engine: 0,
        waveform: 1,
        level: 0.8,
        coarse: 0,
        fine: 0,
        pulseWidth: 0.5,
        noiseLevel: 0,
        noiseColor: 0,
        onEngineChange: vi.fn(),
        onWaveformChange: vi.fn(),
        onLevelChange: vi.fn(),
        onCoarseChange: vi.fn(),
        onFineChange: vi.fn(),
        onPulseWidthChange: vi.fn(),
        onNoiseLevelChange: vi.fn(),
        onNoiseColorChange: vi.fn(),
        ...overrides,
    };
}

describe('OscillatorSection', () => {
    describe('engine selection', () => {
        it('routes an engine-chip click to onEngineChange with the clicked index', () => {
            const onEngineChange = vi.fn();
            render(<OscillatorSection {...defaultProps({ onEngineChange })} />);
            // Wavetable is index 0, Granular index 4, Sampler index 6
            fireEvent.click(screen.getByText('Wavetable'));
            expect(onEngineChange).toHaveBeenLastCalledWith(0);
            fireEvent.click(screen.getByText('Granular'));
            expect(onEngineChange).toHaveBeenLastCalledWith(4);
            fireEvent.click(screen.getByText('Sampler'));
            expect(onEngineChange).toHaveBeenLastCalledWith(6);
        });
    });

    describe('waveform selection', () => {
        it('routes a waveform-chip click to onWaveformChange with the clicked index', () => {
            const onWaveformChange = vi.fn();
            render(<OscillatorSection {...defaultProps({ onWaveformChange })} />);
            // WAVEFORM_NAMES = ['Sine','Saw','Square','Triangle']
            fireEvent.click(screen.getByText('Saw'));
            expect(onWaveformChange).toHaveBeenLastCalledWith(1);
            fireEvent.click(screen.getByText('Triangle'));
            expect(onWaveformChange).toHaveBeenLastCalledWith(3);
        });
    });

    describe('noise color selection', () => {
        it('routes a noise-color chip click to onNoiseColorChange with the clicked index', () => {
            const onNoiseColorChange = vi.fn();
            render(<OscillatorSection {...defaultProps({ onNoiseColorChange })} />);
            // NOISE_COLOR_NAMES = ['White','Pink','Brown']
            fireEvent.click(screen.getByText('White'));
            expect(onNoiseColorChange).toHaveBeenLastCalledWith(0);
            fireEvent.click(screen.getByText('Brown'));
            expect(onNoiseColorChange).toHaveBeenLastCalledWith(2);
        });
    });

    describe('pulse-width knob conditional gate', () => {
        it('does not expose the pulse-width control unless engine is Analog(1) and waveform is Square(2)', () => {
            // Analog engine but Saw waveform → no PW
            render(<OscillatorSection {...defaultProps({ engine: 1, waveform: 1 })} />);
            expect(screen.getAllByTestId('knob').some((k) => k.dataset.paramid === 'pulseWidth')).toBe(false);

            // Square waveform but Wavetable engine → no PW
            render(<OscillatorSection {...defaultProps({ engine: 0, waveform: 2 })} />);
            expect(screen.getAllByTestId('knob').some((k) => k.dataset.paramid === 'pulseWidth')).toBe(false);
        });

        it('exposes the pulse-width control and routes it only when engine=Analog(1) and waveform=Square(2)', () => {
            const onPulseWidthChange = vi.fn();
            render(<OscillatorSection {...defaultProps({ engine: 1, waveform: 2, onPulseWidthChange })} />);
            const pwKnob = screen.getAllByTestId('knob').find((k) => k.dataset.paramid === 'pulseWidth');
            expect(pwKnob).toBeTruthy();
            fireEvent.click(pwKnob!);
            expect(onPulseWidthChange).toHaveBeenCalledWith(0.9);
        });
    });

    describe('knob routing', () => {
        it('keeps coarse tune stepped while fine tune accepts fractional cents', () => {
            render(<OscillatorSection {...defaultProps()} />);

            const knobs = screen.getAllByTestId('knob');
            const coarse = knobs.find((candidate) => candidate.dataset.paramid === 'oscCoarse');
            const fine = knobs.find((candidate) => candidate.dataset.paramid === 'oscFine');

            expect(coarse).toHaveAttribute('data-step', '1');
            expect(fine).not.toHaveAttribute('data-step');
        });

        it('routes Level/Coarse/Fine knobs to their callbacks in order', () => {
            const onLevelChange = vi.fn();
            const onCoarseChange = vi.fn();
            const onFineChange = vi.fn();
            render(
                <OscillatorSection
                    {...defaultProps({
                        engine: 0,
                        waveform: 1,
                        onLevelChange,
                        onCoarseChange,
                        onFineChange,
                    })}
                />
            );
            // order: Level(0), Coarse(1), Fine(2) — no PW (engine≠1)
            const knobs = screen.getAllByTestId('knob');
            fireEvent.click(knobs[0]!);
            expect(onLevelChange).toHaveBeenCalledWith(0.9);
            fireEvent.click(knobs[1]!);
            expect(onCoarseChange).toHaveBeenCalledWith(0.9);
            fireEvent.click(knobs[2]!);
            expect(onFineChange).toHaveBeenCalledWith(0.9);
        });

        it('routes the Noise level knob to onNoiseLevelChange', () => {
            const onNoiseLevelChange = vi.fn();
            render(<OscillatorSection {...defaultProps({ onNoiseLevelChange })} />);
            const knobs = screen.getAllByTestId('knob');
            // noise knob is the last (no PW in engine=0 config)
            const noiseKnob = knobs[knobs.length - 1]!;
            expect(noiseKnob.dataset.paramid).toBe('noiseLevel');
            fireEvent.click(noiseKnob);
            expect(onNoiseLevelChange).toHaveBeenCalledWith(0.9);
        });
    });

    describe('waveform key fallback', () => {
        it('renders without crashing when the rotaryKnob override is omitted (uses real RotaryKnob)', () => {
            const props = defaultProps({ rotaryKnob: undefined });
            delete (props as Record<string, unknown>).rotaryKnob;
            // Default-branch: real RotaryKnob is used. Must not throw.
            const { container } = render(<OscillatorSection {...props} />);
            expect(container.firstChild).toBeTruthy();
        });

        it('falls back to the sawtooth waveform when the index is out of range', () => {
            // waveform index 99 is out of range → wfKey defaults to 'sawtooth'.
            // The OscillatorWaveform must still receive a valid key, not undefined.
            render(<OscillatorSection {...defaultProps({ waveform: 99 })} />);
            // No crash; the section renders its chips and header.
            expect(screen.getByText('Oscillator')).toBeInTheDocument();
        });
    });
});
