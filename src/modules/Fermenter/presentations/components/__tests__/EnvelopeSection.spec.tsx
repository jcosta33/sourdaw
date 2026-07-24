import { type ReactElement } from 'react';

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { type RotaryKnobComponent } from '#/components/daw/RotaryKnob';

// A test-only Knob that surfaces its paramId/value and invokes onChange on click.
// Lets us assert the section's param→callback routing without the real drag logic.
function TestKnob({
    paramId,
    value,
    onChange,
}: {
    paramId?: string;
    value: number;
    onChange: (v: number) => void;
}): ReactElement {
    return (
        <button
            type="button"
            data-testid="knob"
            data-paramid={paramId}
            data-value={value}
            onClick={() => onChange(0.42)}
        >
            knob
        </button>
    );
}

// Capture the props the section passes to ADSREnvelope so we can assert the
// active-env colour and onParamChange routing without the real canvas visualiser.
let adsrProps: {
    attack: number;
    decay: number;
    sustain: number;
    release: number;
    color: string;
    onParamChange?: (paramId: string, value: number) => void;
};
vi.mock('#/components/daw/visualizers/ADSREnvelope', () => ({
    ADSREnvelope: (props: typeof adsrProps) => {
        adsrProps = props;
        return <div data-testid="adsr" />;
    },
}));

import { EnvelopeSection as _Section } from '../EnvelopeSection';

const knob = TestKnob as unknown as RotaryKnobComponent;

function defaultProps(overrides: Record<string, unknown> = {}) {
    return {
        rotaryKnob: knob,
        ampA: 0.1,
        ampD: 0.2,
        ampS: 0.7,
        ampR: 0.3,
        filterA: 0.05,
        filterD: 0.15,
        filterS: 0.4,
        filterR: 0.25,
        onAmpChange: vi.fn(),
        onFilterChange: vi.fn(),
        ...overrides,
    };
}

describe('EnvelopeSection', () => {
    describe('amp/filter toggle', () => {
        it('defaults to the amp envelope, passing amp values and the mint colour to the ADSR hero', () => {
            render(<_Section {...defaultProps()} />);
            // ADSR receives the amp values + mint colour (computed output).
            expect(adsrProps.color).toBe('var(--color-accent-mint)');
            expect(adsrProps.attack).toBe(0.1);
            // The amp-prefixed paramIds confirm the amp envelope is active.
            const knobs = screen.getAllByTestId('knob');
            expect(knobs[0]!.getAttribute('data-paramid')).toBe('ampAttack');
        });

        it('switches to the filter envelope on FILTER click, passing filter values and cyan colour', () => {
            render(<_Section {...defaultProps()} />);
            fireEvent.click(screen.getByText('FILTER'));
            expect(adsrProps.color).toBe('var(--color-accent-cyan)');
            // ADSR now receives the filter values.
            expect(adsrProps.attack).toBe(0.05);
            expect(adsrProps.sustain).toBe(0.4);
        });

        it('switches back to amp on AMP click', () => {
            render(<_Section {...defaultProps()} />);
            fireEvent.click(screen.getByText('FILTER'));
            fireEvent.click(screen.getByText('AMP'));
            expect(adsrProps.color).toBe('var(--color-accent-mint)');
            expect(adsrProps.attack).toBe(0.1);
        });
    });

    describe('knob value formatting', () => {
        it('renders attack/decay/release as milliseconds and sustain as a percentage', () => {
            render(<_Section {...defaultProps({ ampA: 0.12, ampD: 0.34, ampS: 0.6, ampR: 2.5 })} />);
            // A=0.12s→120ms, D=0.34s→340ms, S=0.6→60%, R=2.5s→2500ms
            expect(screen.getByText('120ms')).toBeTruthy();
            expect(screen.getByText('340ms')).toBeTruthy();
            expect(screen.getByText('60%')).toBeTruthy();
            expect(screen.getByText('2500ms')).toBeTruthy();
        });
    });

    describe('param routing via knob onChange', () => {
        it('routes amp Attack knob changes to onAmpChange with the ampAttack key', () => {
            const onAmpChange = vi.fn();
            render(<_Section {...defaultProps({ onAmpChange })} />);
            // the Attack knob is the first; clicking it calls onChange(0.42)
            const attackKnob = screen.getAllByTestId('knob')[0]!;
            fireEvent.click(attackKnob);
            expect(onAmpChange).toHaveBeenCalledWith('ampAttack', 0.42);
        });

        it('routes filter Sustain knob changes to onFilterChange with the filterSustain key', () => {
            const onFilterChange = vi.fn();
            render(<_Section {...defaultProps({ onFilterChange })} />);
            fireEvent.click(screen.getByText('FILTER'));
            // Sustain is the 3rd knob (A,D,S,R)
            const sustainKnob = screen.getAllByTestId('knob')[2]!;
            fireEvent.click(sustainKnob);
            expect(onFilterChange).toHaveBeenCalledWith('filterSustain', 0.42);
        });

        it('passes the prefixed paramId to each knob', () => {
            render(<_Section {...defaultProps()} />);
            const knobs = screen.getAllByTestId('knob');
            expect(knobs[0]!.getAttribute('data-paramid')).toBe('ampAttack');
            expect(knobs[3]!.getAttribute('data-paramid')).toBe('ampRelease');
        });

        it('passes the filter-prefixed paramId after switching to the filter envelope', () => {
            render(<_Section {...defaultProps()} />);
            fireEvent.click(screen.getByText('FILTER'));
            const knobs = screen.getAllByTestId('knob');
            expect(knobs[0]!.getAttribute('data-paramid')).toBe('filterAttack');
            expect(knobs[2]!.getAttribute('data-paramid')).toBe('filterSustain');
        });
    });

    describe('ADSR hero onParamChange routing', () => {
        it('routes an ADSR attack drag to onAmpChange in amp mode', () => {
            const onAmpChange = vi.fn();
            render(<_Section {...defaultProps({ onAmpChange })} />);
            adsrProps.onParamChange!('attack', 0.9);
            expect(onAmpChange).toHaveBeenCalledWith('ampAttack', 0.9);
        });

        it('routes an ADSR sustain drag to onFilterChange in filter mode', () => {
            const onFilterChange = vi.fn();
            render(<_Section {...defaultProps({ onFilterChange })} />);
            fireEvent.click(screen.getByText('FILTER'));
            adsrProps.onParamChange!('sustain', 0.3);
            expect(onFilterChange).toHaveBeenCalledWith('filterSustain', 0.3);
        });

        it('ignores an unknown ADSR paramId', () => {
            const onAmpChange = vi.fn();
            const onFilterChange = vi.fn();
            render(<_Section {...defaultProps({ onAmpChange, onFilterChange })} />);
            adsrProps.onParamChange!('unknownParam', 1);
            expect(onAmpChange).not.toHaveBeenCalled();
            expect(onFilterChange).not.toHaveBeenCalled();
        });
    });
});
