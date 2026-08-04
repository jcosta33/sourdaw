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

describe('CrustMeteringStrip — section headers', () => {
    it('renders Output, Loudness, and TP max sections', () => {
        render(<CrustMeteringStrip {...defaultProps()} />);
        expect(screen.getByText('Output')).toBeInTheDocument();
        expect(screen.getByText('Loudness')).toBeInTheDocument();
        expect(screen.getByText('TP max')).toBeInTheDocument();
    });
});
