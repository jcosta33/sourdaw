import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { createDefaultMorphState } from '../../../models/GrandBouleMorphState';
import { MorphPanel } from '../MorphPanel';

describe('MorphPanel', () => {
    it('should render', () => {
        render(
            <MorphPanel
                morph={createDefaultMorphState()}
                onMorphPositionChange={vi.fn()}
                onLayerBalanceChange={vi.fn()}
                onModelAChange={vi.fn()}
                onModelBChange={vi.fn()}
                onEnabledChange={vi.fn()}
            />
        );
        expect(screen.getByText(/enable morph/i)).toBeInTheDocument();
    });
});
