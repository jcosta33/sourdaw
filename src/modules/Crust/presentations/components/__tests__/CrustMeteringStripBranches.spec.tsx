import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { CrustMeteringStrip } from '../CrustMeteringStrip';

function defaultProps(overrides: Record<string, unknown> = {}) {
    return {
        grDb: -3,
        outputDb: -6,
        lufsIntegrated: -14,
        lufsShortTerm: -14,
        lufsMomentary: -14,
        lra: 5.5,
        truepeakMax: -1.0,
        truepeakExceeded: false,
        lufsTarget: null,
        onResetTp: vi.fn(),
        ...overrides,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('CrustMeteringStrip — integrated LUFS display', () => {
    it('shows formatted LUFS value', () => {
        render(<CrustMeteringStrip {...defaultProps({ lufsIntegrated: -14 })} />);
        // Multiple readouts may show -14.0 (integrated, ST, MOM)
        expect(screen.getAllByText('-14.0').length).toBeGreaterThan(0);
    });

    it('shows em dash when LUFS is -99 or lower', () => {
        render(<CrustMeteringStrip {...defaultProps({ lufsIntegrated: -99 })} />);
        // The -99 value shows '—'
        expect(screen.getByText('—')).toBeInTheDocument();
    });

    it('aria-label includes formatted integrated LUFS', () => {
        render(<CrustMeteringStrip {...defaultProps({ lufsIntegrated: -12 })} />);
        expect(screen.getByLabelText(/Integrated LUFS: -12\.0/)).toBeInTheDocument();
    });
});

describe('CrustMeteringStrip — target diff', () => {
    it('does not show target diff when lufsTarget is null', () => {
        render(<CrustMeteringStrip {...defaultProps({ lufsTarget: null })} />);
        // No parenthesized diff text
        expect(screen.queryByText(/^\(/)).toBeNull();
    });

    it('shows positive target diff with + sign when integrated > target', () => {
        render(<CrustMeteringStrip {...defaultProps({ lufsIntegrated: -12, lufsTarget: -14 })} />);
        expect(screen.getByText('(+2.0)')).toBeInTheDocument();
    });

    it('shows negative target diff without + sign when integrated < target', () => {
        render(<CrustMeteringStrip {...defaultProps({ lufsIntegrated: -16, lufsTarget: -14 })} />);
        expect(screen.getByText('(-2.0)')).toBeInTheDocument();
    });
});

describe('CrustMeteringStrip — true peak LED', () => {
    it('shows "Clear" when truepeakExceeded is false', () => {
        render(<CrustMeteringStrip {...defaultProps({ truepeakExceeded: false })} />);
        expect(screen.getByText('Clear')).toBeInTheDocument();
    });

    it('shows "Clip" when truepeakExceeded is true', () => {
        render(<CrustMeteringStrip {...defaultProps({ truepeakExceeded: true })} />);
        expect(screen.getByText('Clip')).toBeInTheDocument();
    });

    it('reset button calls onResetTp when clicked', () => {
        const onResetTp = vi.fn();
        render(<CrustMeteringStrip {...defaultProps({ onResetTp })} />);
        fireEvent.click(screen.getByRole('button', { name: /reset true peak/i }));
        expect(onResetTp).toHaveBeenCalledTimes(1);
    });

    it('provides a 24 pixel reset target while retaining the compact status light', () => {
        render(<CrustMeteringStrip {...defaultProps()} />);

        const reset = screen.getByRole('button', { name: 'Reset true peak indicator' });
        expect(reset).toHaveClass('size-6');
        expect(reset.querySelector('[data-testid="true-peak-status-light"]')).toHaveClass('size-2');
    });
});

describe('CrustMeteringStrip — LRA display', () => {
    it('shows LRA with LU unit', () => {
        render(<CrustMeteringStrip {...defaultProps({ lra: 7.3 })} />);
        expect(screen.getByText('7.3 LU')).toBeInTheDocument();
    });

    it('aria-label includes formatted LRA', () => {
        render(<CrustMeteringStrip {...defaultProps({ lra: 7.3 })} />);
        expect(screen.getByLabelText(/Loudness range: 7\.3 LU/)).toBeInTheDocument();
    });
});

describe('CrustMeteringStrip — GR display', () => {
    it('GR aria-label includes absolute gain reduction', () => {
        render(<CrustMeteringStrip {...defaultProps({ grDb: -4.5 })} />);
        expect(screen.getByLabelText(/Gain reduction: 4\.5 dB/)).toBeInTheDocument();
    });
});

describe('CrustMeteringStrip — semantic meter text', () => {
    it('uses theme-aware roles for neutral status, channel labels, and normal GR text', () => {
        render(<CrustMeteringStrip {...defaultProps({ grDb: 0 })} />);

        expect(screen.getByText('Clear')).toHaveClass('bg-surface-default', 'text-text-secondary');
        for (const label of ['L', 'R']) {
            expect(screen.getByText(label)).toHaveClass('text-muted-foreground');
            expect(screen.getByText(label)).not.toHaveClass('text-muted-foreground/50');
        }
        expect(screen.getByLabelText('Gain reduction: 0.0 dB').style.color).toBe('var(--color-text-primary)');
    });
});

describe('CrustMeteringStrip — section headers', () => {
    it('renders Output, Loudness, and TP max sections', () => {
        render(<CrustMeteringStrip {...defaultProps()} />);
        expect(screen.getByText('Output')).toBeInTheDocument();
        expect(screen.getByText('Loudness')).toBeInTheDocument();
        expect(screen.getByText('TP max')).toBeInTheDocument();
    });
});

describe('CrustMeteringStrip — semantic loudness colors', () => {
    it.each([
        { lufsIntegrated: -14, lufsTarget: null, color: 'var(--color-text-primary)' },
        { lufsIntegrated: -14, lufsTarget: -14, color: 'var(--color-state-play)' },
        { lufsIntegrated: -12, lufsTarget: -14, color: 'var(--color-state-danger)' },
        { lufsIntegrated: -16, lufsTarget: -14, color: 'var(--color-text-primary)' },
    ])('uses $color for integrated $lufsIntegrated against target $lufsTarget', (props) => {
        render(<CrustMeteringStrip {...defaultProps(props)} />);

        const integrated = screen.getByLabelText(`Integrated LUFS: ${props.lufsIntegrated.toFixed(1)}`);
        expect(integrated.style.color).toBe(props.color);
        expect(screen.getByText('LUFS')).toHaveClass('text-muted-foreground');
        expect(screen.getByText('LUFS')).not.toHaveClass('text-muted-foreground/50');
    });

    it.each([
        { lufsIntegrated: -14, lufsTarget: -14, text: '(0.0)', color: 'var(--color-state-play)' },
        { lufsIntegrated: -12, lufsTarget: -14, text: '(+2.0)', color: 'var(--color-state-danger)' },
        { lufsIntegrated: -16, lufsTarget: -14, text: '(-2.0)', color: 'var(--color-state-warning)' },
    ])('uses $color for target delta $text', (props) => {
        render(<CrustMeteringStrip {...defaultProps(props)} />);

        expect(screen.getByText(props.text).style.color).toBe(props.color);
    });
});
