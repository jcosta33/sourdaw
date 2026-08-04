import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('#/components/daw/RotaryKnob', () => ({
    RotaryKnob: ({
        value,
        onChange,
        'data-testid': testId,
    }: {
        value: number;
        onChange: (v: number) => void;
        'data-testid'?: string;
    }) => (
        <button type="button" data-testid={testId ?? 'rotary'} onClick={() => onChange(value + 1)}>
            knob:{value}
        </button>
    ),
}));

import { LegatoTuning } from '../LegatoTuning';

import type { LegatoConfig } from '../../../models/LevainPatch';

function makeConfig(overrides: Partial<LegatoConfig> = {}): LegatoConfig {
    return {
        enabled: true,
        adaptiveSpeed: false,
        slowThresholdMs: 300,
        fastThresholdMs: 100,
        portamentoVelocityThreshold: 64,
        ...overrides,
    };
}

function renderTuning(config: LegatoConfig, onChange = vi.fn()) {
    render(<LegatoTuning config={config} onChange={onChange} />);
    return { onChange };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('LegatoTuning — adaptive speed toggle label', () => {
    it('shows "Adaptive Off" when adaptiveSpeed is false', () => {
        renderTuning(makeConfig({ adaptiveSpeed: false }));
        expect(screen.getByText(/Adaptive Off/)).toBeInTheDocument();
    });

    it('shows "Adaptive On" when adaptiveSpeed is true', () => {
        renderTuning(makeConfig({ adaptiveSpeed: true }));
        expect(screen.getByText(/Adaptive On/)).toBeInTheDocument();
    });

    it('toggle calls onChange with flipped adaptiveSpeed', () => {
        const { onChange } = renderTuning(makeConfig({ adaptiveSpeed: false }));
        fireEvent.click(screen.getByText(/Adaptive Off/));
        expect(onChange).toHaveBeenCalledWith({ adaptiveSpeed: true });
    });
});

describe('LegatoTuning — knob labels', () => {
    it('renders Slow, Fast, and Porto Vel labels', () => {
        renderTuning(makeConfig());
        expect(screen.getByText('Slow')).toBeInTheDocument();
        expect(screen.getByText('Fast')).toBeInTheDocument();
        expect(screen.getByText('Porto Vel')).toBeInTheDocument();
    });
});

describe('LegatoTuning — computed knob values', () => {
    it('renders slow threshold in ms', () => {
        renderTuning(makeConfig({ slowThresholdMs: 350 }));
        expect(screen.getByText('350ms')).toBeInTheDocument();
    });

    it('renders fast threshold in ms', () => {
        renderTuning(makeConfig({ fastThresholdMs: 80 }));
        expect(screen.getByText('80ms')).toBeInTheDocument();
    });

    it('renders portamento velocity threshold as integer', () => {
        renderTuning(makeConfig({ portamentoVelocityThreshold: 100 }));
        expect(screen.getByText('100')).toBeInTheDocument();
    });
});

describe('LegatoTuning — knob onChange wiring', () => {
    it('slow knob calls onChange with slowThresholdMs', () => {
        const { onChange } = renderTuning(makeConfig({ slowThresholdMs: 300 }));
        const knobs = screen.getAllByTestId('rotary');
        fireEvent.click(knobs[0]!);
        expect(onChange).toHaveBeenCalledWith({ slowThresholdMs: 301 });
    });

    it('fast knob calls onChange with fastThresholdMs', () => {
        const { onChange } = renderTuning(makeConfig({ fastThresholdMs: 100 }));
        const knobs = screen.getAllByTestId('rotary');
        fireEvent.click(knobs[1]!);
        expect(onChange).toHaveBeenCalledWith({ fastThresholdMs: 101 });
    });

    it('portamento knob calls onChange with rounded value', () => {
        const { onChange } = renderTuning(makeConfig({ portamentoVelocityThreshold: 64 }));
        const knobs = screen.getAllByTestId('rotary');
        fireEvent.click(knobs[2]!);
        expect(onChange).toHaveBeenCalledWith({ portamentoVelocityThreshold: 65 });
    });
});

describe('LegatoTuning — section header', () => {
    it('renders the Legato section title', () => {
        renderTuning(makeConfig());
        expect(screen.getByText('Legato')).toBeInTheDocument();
    });
});
