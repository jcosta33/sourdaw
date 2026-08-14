import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { type GrandBouleMorphState, createDefaultMorphState } from '../../../models/GrandBouleMorphState';
import { MorphPanel } from '../MorphPanel';

function morph(overrides: Partial<GrandBouleMorphState> = {}): GrandBouleMorphState {
    return { ...createDefaultMorphState(), ...overrides };
}

function defaultProps(overrides: Partial<Parameters<typeof MorphPanel>[0]> = {}) {
    return {
        morph: morph(),
        onMorphPositionChange: vi.fn(),
        onLayerBalanceChange: vi.fn(),
        onModelAChange: vi.fn(),
        onModelBChange: vi.fn(),
        onEnabledChange: vi.fn(),
        ...overrides,
    };
}

describe('MorphPanel — enable toggle', () => {
    it('renders OFF when morph is disabled', () => {
        render(<MorphPanel {...defaultProps({ morph: morph({ enabled: false }) })} />);
        const toggle = screen.getByRole('button', { name: 'OFF' });
        expect(toggle.getAttribute('aria-pressed')).toBe('false');
    });

    it('renders ON when morph is enabled', () => {
        render(<MorphPanel {...defaultProps({ morph: morph({ enabled: true }) })} />);
        const toggle = screen.getByRole('button', { name: 'ON' });
        expect(toggle.getAttribute('aria-pressed')).toBe('true');
    });

    it('calls onEnabledChange when the toggle is clicked', () => {
        const onEnabledChange = vi.fn();
        render(<MorphPanel {...defaultProps({ morph: morph({ enabled: false }), onEnabledChange })} />);
        fireEvent.click(screen.getByRole('button', { name: 'OFF' }));
        expect(onEnabledChange).toHaveBeenCalledWith(true);
    });
});

describe('MorphPanel — balance readout formatting', () => {
    it('shows "center" when balance is near zero', () => {
        render(<MorphPanel {...defaultProps({ morph: morph({ layerBalance: 0 }) })} />);
        expect(screen.getByText('center')).toBeInTheDocument();
    });

    it('shows "A <n>%" when balance leans toward A (negative)', () => {
        render(<MorphPanel {...defaultProps({ morph: morph({ layerBalance: -0.6 }) })} />);
        expect(screen.getByText('A 60%')).toBeInTheDocument();
    });

    it('shows "B <n>%" when balance leans toward B (positive)', () => {
        render(<MorphPanel {...defaultProps({ morph: morph({ layerBalance: 0.4 }) })} />);
        expect(screen.getByText('B 40%')).toBeInTheDocument();
    });
});

describe('MorphPanel — morph position readout', () => {
    it('shows the morph position as a percentage', () => {
        render(<MorphPanel {...defaultProps({ morph: morph({ morphPosition: 0.75 }) })} />);
        expect(screen.getByText('75%')).toBeInTheDocument();
    });
});

describe('MorphPanel — knob accessible names', () => {
    it('exposes the morph and balance knobs as named sliders', () => {
        render(<MorphPanel {...defaultProps({ morph: morph({ enabled: true }) })} />);
        expect(screen.getByRole('slider', { name: 'Morph' })).toBeInTheDocument();
        expect(screen.getByRole('slider', { name: 'Balance' })).toBeInTheDocument();
    });
});

describe('MorphPanel — disabled state', () => {
    it('dims the knob area when morph is disabled', () => {
        const { container } = render(<MorphPanel {...defaultProps({ morph: morph({ enabled: false }) })} />);
        const dimmed = container.querySelector('.pointer-events-none.opacity-35');
        expect(dimmed).not.toBeNull();
    });

    it('does not dim the knob area when morph is enabled', () => {
        const { container } = render(<MorphPanel {...defaultProps({ morph: morph({ enabled: true }) })} />);
        const dimmed = container.querySelector('.pointer-events-none.opacity-35');
        expect(dimmed).toBeNull();
    });
});
