import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { DEFAULT_PATCH } from '../../../models/BacteriaPatch';
import { ModulationDock } from '../ModulationDock';

describe('ModulationDock', () => {
    it('should render', () => {
        render(
            <ModulationDock
                patch={DEFAULT_PATCH}
                modValues={Array.from({ length: 9 }, () => 0)}
                onAssignmentAdd={vi.fn()}
                onAssignmentRemove={vi.fn()}
            />
        );
        expect(screen.getByText(/modulation sources/i)).toBeInTheDocument();
    });
});
