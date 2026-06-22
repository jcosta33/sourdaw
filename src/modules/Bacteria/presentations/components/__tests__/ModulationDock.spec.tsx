import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { DEFAULT_PATCH, type BacteriaPatch } from '../../../models/BacteriaPatch';
import { ModulationDock } from '../ModulationDock';

describe('ModulationDock', () => {
    it('should render the source tray', () => {
        render(
            <ModulationDock
                patch={DEFAULT_PATCH}
                modValues={Array.from({ length: 9 }, () => 0)}
                onAssignmentRemove={vi.fn()}
            />
        );
        expect(screen.getByText(/modulation sources/i)).toBeInTheDocument();
    });

    it('lists existing assignments and removes the clicked row', () => {
        const patch: BacteriaPatch = {
            ...DEFAULT_PATCH,
            modAssignments: [
                { sourceId: 'lfo1', targetParam: 'filterCutoff', amount: 0.5, bipolar: false },
                { sourceId: 'lfo2', targetParam: 'drive', amount: -0.25, bipolar: true },
            ],
        };
        const onAssignmentRemove = vi.fn();

        render(
            <ModulationDock
                patch={patch}
                modValues={Array.from({ length: 9 }, () => 0)}
                onAssignmentRemove={onAssignmentRemove}
            />
        );

        expect(screen.getByText('filterCutoff')).toBeInTheDocument();
        expect(screen.getByText('drive')).toBeInTheDocument();

        const removeButtons = screen.getAllByRole('button', { name: '×' });
        expect(removeButtons).toHaveLength(2);

        fireEvent.click(removeButtons[1] as HTMLElement);
        expect(onAssignmentRemove).toHaveBeenCalledWith(1);
    });
});
