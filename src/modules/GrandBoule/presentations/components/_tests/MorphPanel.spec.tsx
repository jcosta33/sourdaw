import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MorphPanel } from '../MorphPanel';
import { createDefaultMorphState } from '../../../models/GrandBouleMorphState';

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
