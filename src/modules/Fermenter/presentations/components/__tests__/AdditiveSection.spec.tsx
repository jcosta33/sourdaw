import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { AdditiveSection } from '../AdditiveSection';

function defaultProps(overrides: Record<string, unknown> = {}) {
    return {
        partials: 32,
        tilt: 0,
        oddEmphasis: 0,
        inharmonicity: 0,
        onParam: vi.fn(),
        ...overrides,
    };
}

describe('AdditiveSection', () => {
    describe('readout formatting', () => {
        it('renders the partial count as an integer', () => {
            render(<AdditiveSection {...defaultProps({ partials: 48 })} />);
            expect(screen.getByText('48')).toBeInTheDocument();
        });

        it('formats the tilt with one decimal in dB', () => {
            render(<AdditiveSection {...defaultProps({ tilt: -3.25 })} />);
            expect(screen.getByText('-3.3dB')).toBeInTheDocument();
        });

        it('formats the odd emphasis as a whole-number percentage', () => {
            render(<AdditiveSection {...defaultProps({ oddEmphasis: 0.666 })} />);
            expect(screen.getByText('67%')).toBeInTheDocument();
        });

        it('formats inharmonicity in per-mille (×1000, one decimal)', () => {
            render(<AdditiveSection {...defaultProps({ inharmonicity: 0.0456 })} />);
            // 0.0456 * 1000 = 45.6 → "45.6"
            expect(screen.getByText('45.6')).toBeInTheDocument();
        });
    });

    describe('knob routing', () => {
        it('emits additivePartials when the Partials slider is incremented', () => {
            const onParam = vi.fn();
            render(<AdditiveSection {...defaultProps({ onParam })} />);
            const partialsSlider = screen.getAllByRole('slider')[0]!;
            partialsSlider.focus();
            fireEvent.keyDown(partialsSlider, { key: 'ArrowUp' });
            expect(onParam).toHaveBeenCalledWith('additivePartials', expect.any(Number));
        });

        it('emits additiveTilt when the Tilt slider is incremented', () => {
            const onParam = vi.fn();
            render(<AdditiveSection {...defaultProps({ onParam })} />);
            const tiltSlider = screen.getAllByRole('slider')[1]!;
            tiltSlider.focus();
            fireEvent.keyDown(tiltSlider, { key: 'ArrowUp' });
            expect(onParam).toHaveBeenCalledWith('additiveTilt', expect.any(Number));
        });
    });
});
