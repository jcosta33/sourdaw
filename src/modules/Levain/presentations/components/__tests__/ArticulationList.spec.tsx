import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { createDefaultPatch } from '../../../models/LevainPatch';
import { ArticulationList } from '../ArticulationList';

describe('ArticulationList', () => {
    it('should render', () => {
        const patch = createDefaultPatch('violin-1');
        render(
            <ArticulationList
                articulations={patch.articulations}
                current={patch.currentArticulation}
                grid
                onSelect={vi.fn()}
            />
        );
        expect(screen.getAllByText(/^Long$/).length).toBeGreaterThan(0);
    });
});
