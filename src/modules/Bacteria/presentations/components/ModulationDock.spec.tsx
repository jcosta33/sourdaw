import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ModulationDock } from './ModulationDock';
import { DEFAULT_PATCH } from '../../models/BacteriaPatch';

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
