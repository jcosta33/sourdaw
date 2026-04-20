import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { DEFAULT_PATCH } from '../../../models/FermenterPatch';
import { LayerStack } from '../LayerStack';

describe('LayerStack', () => {
    it('should render', () => {
        const p = DEFAULT_PATCH;
        render(
            <LayerStack
                numLayers={p.numLayers}
                activeLayer={p.activeLayer}
                layerLevel={p.layerLevel}
                layerPan={p.layerPan}
                currentEngine={p.oscEngine}
                onActiveLayerChange={vi.fn()}
                onNumLayersChange={vi.fn()}
                onLevelChange={vi.fn()}
                onPanChange={vi.fn()}
            />
        );
        expect(screen.getByText(/layers/i)).toBeInTheDocument();
    });
});
