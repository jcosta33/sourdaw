import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { type HumanizeConfig, createDefaultPatch } from '../../../models/LevainPatch';
import { HumanizePanel } from '../HumanizePanel';

vi.mock('#/components/daw/RotaryKnob', () => ({
    RotaryKnob: ({ value, onChange, max }: { value: number; onChange: (v: number) => void; max: number }) => (
        <input
            type="range"
            data-testid={`knob-max-${max}`}
            value={value}
            onChange={(event) => onChange(Number(event.target.value))}
        />
    ),
}));

function config(overrides: Partial<HumanizeConfig> = {}): HumanizeConfig {
    return { ...createDefaultPatch('violin-1').humanize, ...overrides };
}

describe('HumanizePanel', () => {
    it('should render', () => {
        render(<HumanizePanel config={config()} onChange={vi.fn()} />);
        expect(screen.getByText(/humanization/i)).toBeTruthy();
    });

    it('forwards the master amount through onChange', () => {
        const onChange = vi.fn();
        render(<HumanizePanel config={config()} onChange={onChange} />);
        fireEvent.change(screen.getByTestId('knob-max-1'), { target: { value: '0.7' } });
        expect(onChange).toHaveBeenCalledWith({ amount: 0.7 });
    });

    it('rescales the dynamic knob (percent) back to a 0-1 fraction in onChange', () => {
        const onChange = vi.fn();
        render(<HumanizePanel config={config()} onChange={onChange} />);
        fireEvent.change(screen.getByTestId('knob-max-15'), { target: { value: '10' } });
        expect(onChange).toHaveBeenCalledWith({ dynamicMax: 0.1 });
    });
});

describe('HumanizePanel — computed readouts', () => {
    it('shows amount as a percentage of 100', () => {
        render(<HumanizePanel config={config({ amount: 0.35 })} onChange={vi.fn()} />);
        expect(screen.getByText('35%')).toBeTruthy();
    });

    it('shows timing in milliseconds', () => {
        render(<HumanizePanel config={config({ timingMaxMs: 12.7 })} onChange={vi.fn()} />);
        expect(screen.getByText('±13ms')).toBeTruthy();
    });

    it('shows tuning in cents', () => {
        render(<HumanizePanel config={config({ tuningMaxCents: 7.3 })} onChange={vi.fn()} />);
        expect(screen.getByText('±7ct')).toBeTruthy();
    });

    it('shows dynamic as percentage', () => {
        render(<HumanizePanel config={config({ dynamicMax: 0.08 })} onChange={vi.fn()} />);
        expect(screen.getByText('±8%')).toBeTruthy();
    });

    it('shows vibrato variation as percentage', () => {
        render(<HumanizePanel config={config({ vibratoVarMax: 0.15 })} onChange={vi.fn()} />);
        expect(screen.getByText('±15%')).toBeTruthy();
    });
});

describe('HumanizePanel — knob onChange transforms', () => {
    it('forwards tuningMaxMs unchanged', () => {
        const onChange = vi.fn();
        render(<HumanizePanel config={config()} onChange={onChange} />);
        fireEvent.change(screen.getByTestId('knob-max-25'), { target: { value: '8.5' } });
        expect(onChange).toHaveBeenCalledWith({ timingMaxMs: 8.5 });
    });

    it('rescales vibrato knob (max=30) back to 0-1 fraction', () => {
        const onChange = vi.fn();
        render(<HumanizePanel config={config()} onChange={onChange} />);
        fireEvent.change(screen.getByTestId('knob-max-30'), { target: { value: '20' } });
        expect(onChange).toHaveBeenCalledWith({ vibratoVarMax: 0.2 });
    });
});
