import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { CrustGainStrip } from '../CrustGainStrip';

beforeEach(() => {
    vi.clearAllMocks();
});

describe('CrustGainStrip — slider structure', () => {
    it('renders a slider with aria-label "Input gain"', () => {
        render(<CrustGainStrip value={6} onChange={vi.fn()} />);
        expect(screen.getByRole('slider')).toHaveAttribute('aria-label', 'Input gain');
    });

    it('aria-valuemin is 0', () => {
        render(<CrustGainStrip value={6} onChange={vi.fn()} />);
        expect(screen.getByRole('slider')).toHaveAttribute('aria-valuemin', '0');
    });

    it('aria-valuemax is 18', () => {
        render(<CrustGainStrip value={6} onChange={vi.fn()} />);
        expect(screen.getByRole('slider')).toHaveAttribute('aria-valuemax', '18');
    });

    it('aria-valuenow reflects the value rounded to 1 decimal', () => {
        render(<CrustGainStrip value={6.25} onChange={vi.fn()} />);
        expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '6.3');
    });

    it('aria-valuetext includes the formatted dB value', () => {
        render(<CrustGainStrip value={3.5} onChange={vi.fn()} />);
        expect(screen.getByRole('slider')).toHaveAttribute('aria-valuetext', '3.5 dB');
    });
});

describe('CrustGainStrip — numeric readout', () => {
    it('shows + prefix for positive values', () => {
        render(<CrustGainStrip value={6} onChange={vi.fn()} />);
        expect(screen.getByText('+6.0')).toBeInTheDocument();
    });

    it('does not show + prefix for zero', () => {
        render(<CrustGainStrip value={0} onChange={vi.fn()} />);
        expect(screen.getByText('0.0')).toBeInTheDocument();
    });

    it('shows the dB unit label', () => {
        render(<CrustGainStrip value={6} onChange={vi.fn()} />);
        expect(screen.getByText('dB')).toBeInTheDocument();
    });

    it('renders the Gain label', () => {
        render(<CrustGainStrip value={6} onChange={vi.fn()} />);
        expect(screen.getByText('Gain')).toBeInTheDocument();
    });

    it.each(['Gain', '0', 'dB'])('uses an opaque semantic text role for the %s label', (label) => {
        render(<CrustGainStrip value={6} onChange={vi.fn()} />);

        expect(screen.getByText(label)).toHaveClass('text-muted-foreground');
        expect(screen.getByText(label)).not.toHaveClass('text-muted-foreground/30');
        expect(screen.getByText(label)).not.toHaveClass('text-muted-foreground/40');
    });
});

describe('CrustGainStrip — keyboard interaction', () => {
    it('ArrowUp increases value by 0.1', () => {
        const onChange = vi.fn();
        render(<CrustGainStrip value={6} onChange={onChange} />);
        fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowUp' });
        expect(onChange).toHaveBeenCalledWith(6.1, false);
    });

    it('ArrowDown decreases value by 0.1', () => {
        const onChange = vi.fn();
        render(<CrustGainStrip value={6} onChange={onChange} />);
        fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowDown' });
        expect(onChange).toHaveBeenCalledWith(5.9, false);
    });

    it('Shift+ArrowUp increases value by 1', () => {
        const onChange = vi.fn();
        render(<CrustGainStrip value={6} onChange={onChange} />);
        fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowUp', shiftKey: true });
        expect(onChange).toHaveBeenCalledWith(7, false);
    });

    it('Shift+ArrowDown decreases value by 1', () => {
        const onChange = vi.fn();
        render(<CrustGainStrip value={6} onChange={onChange} />);
        fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowDown', shiftKey: true });
        expect(onChange).toHaveBeenCalledWith(5, false);
    });

    it('clamps to MAX (18) on ArrowUp', () => {
        const onChange = vi.fn();
        render(<CrustGainStrip value={17.9} onChange={onChange} />);
        fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowUp' });
        expect(onChange).toHaveBeenCalledWith(18, false);
    });

    it('clamps to MIN (0) on ArrowDown', () => {
        const onChange = vi.fn();
        render(<CrustGainStrip value={0.05} onChange={onChange} />);
        fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowDown' });
        expect(onChange).toHaveBeenCalledWith(0, false);
    });
});
