import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { LayerStack } from '../LayerStack';

function defaultProps(overrides: Record<string, unknown> = {}) {
    return {
        numLayers: 2,
        activeLayer: 0,
        layerLevel: 1,
        layerPan: 0,
        currentEngine: 0,
        onActiveLayerChange: vi.fn(),
        onNumLayersChange: vi.fn(),
        onLevelChange: vi.fn(),
        onPanChange: vi.fn(),
        ...overrides,
    };
}

describe('LayerStack', () => {
    describe('layer count controls', () => {
        it('disables the remove button when only one layer remains', () => {
            render(<LayerStack {...defaultProps({ numLayers: 1 })} />);
            const minusBtn = screen.getByRole('button', { name: 'Decrease layer count' });
            expect(minusBtn).toBeDisabled();
        });

        it('disables the add button when four layers exist', () => {
            render(<LayerStack {...defaultProps({ numLayers: 4 })} />);
            const plusBtn = screen.getByRole('button', { name: 'Increase layer count' });
            expect(plusBtn).toBeDisabled();
        });

        it('emits the decremented layer count when remove is clicked', () => {
            const onNumLayersChange = vi.fn();
            render(<LayerStack {...defaultProps({ numLayers: 3, onNumLayersChange })} />);
            const minusBtn = screen.getByRole('button', { name: 'Decrease layer count' });
            fireEvent.click(minusBtn);
            expect(onNumLayersChange).toHaveBeenLastCalledWith(2);
        });

        it('emits the incremented layer count when add is clicked', () => {
            const onNumLayersChange = vi.fn();
            render(<LayerStack {...defaultProps({ numLayers: 2, onNumLayersChange })} />);
            const plusBtn = screen.getByRole('button', { name: 'Increase layer count' });
            fireEvent.click(plusBtn);
            expect(onNumLayersChange).toHaveBeenLastCalledWith(3);
        });
    });

    describe('layer selection', () => {
        it('renders one layer button per layer', () => {
            render(<LayerStack {...defaultProps({ numLayers: 3 })} />);
            expect(screen.getByText('Layer 1')).toBeInTheDocument();
            expect(screen.getByText('Layer 2')).toBeInTheDocument();
            expect(screen.getByText('Layer 3')).toBeInTheDocument();
        });

        it('routes a layer-button click to onActiveLayerChange with the index', () => {
            const onActiveLayerChange = vi.fn();
            render(<LayerStack {...defaultProps({ numLayers: 3, activeLayer: 0, onActiveLayerChange })} />);
            fireEvent.click(screen.getByText('Layer 2'));
            expect(onActiveLayerChange).toHaveBeenLastCalledWith(1);
        });

        it('shows the current engine name only for the active layer', () => {
            // ENGINE_NAMES = ['Wavetable','Analog','FM','String','Granular','Additive','Sampler']
            render(<LayerStack {...defaultProps({ numLayers: 2, activeLayer: 0, currentEngine: 3 })} />);
            // Active layer 0 → 'String'; inactive layer shows an em dash.
            expect(screen.getByText('String')).toBeInTheDocument();
            expect(screen.getAllByText('—').length).toBeGreaterThan(0);
        });

        it('falls back to "Wavetable" when the engine index is out of range', () => {
            render(<LayerStack {...defaultProps({ activeLayer: 0, currentEngine: 99 })} />);
            expect(screen.getByText('Wavetable')).toBeInTheDocument();
        });
    });

    describe('active layer level + pan knobs', () => {
        it('emits onLevelChange when the Level slider is incremented', () => {
            const onLevelChange = vi.fn();
            render(<LayerStack {...defaultProps({ layerLevel: 0.5, onLevelChange })} />);
            const levelSlider = screen.getAllByRole('slider')[0]!;
            levelSlider.focus();
            fireEvent.keyDown(levelSlider, { key: 'ArrowUp' });
            expect(onLevelChange).toHaveBeenCalledWith(0.51, false);
        });

        it('emits onPanChange when the Pan slider is incremented', () => {
            const onPanChange = vi.fn();
            render(<LayerStack {...defaultProps({ layerPan: 0, onPanChange })} />);
            const panSlider = screen.getAllByRole('slider')[1]!;
            panSlider.focus();
            fireEvent.keyDown(panSlider, { key: 'ArrowUp' });
            expect(onPanChange).toHaveBeenCalledWith(0.01, false);
        });
    });
});
