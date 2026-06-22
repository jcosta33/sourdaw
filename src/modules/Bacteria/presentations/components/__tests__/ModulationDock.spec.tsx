import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { DEFAULT_PATCH } from '../../../models/BacteriaPatch';
import { BACTERIA_MOD_SOURCE_DRAG_TYPE, ModulationDock } from '../ModulationDock';

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

    it('carries the dragged source id on the drag dataTransfer so a knob can resolve it', () => {
        render(
            <ModulationDock
                patch={DEFAULT_PATCH}
                modValues={Array.from({ length: 9 }, () => 0)}
                onAssignmentAdd={vi.fn()}
                onAssignmentRemove={vi.fn()}
            />
        );

        const setData = vi.fn();
        const dataTransfer = { setData, effectAllowed: '' };
        const lfo1Pill = screen.getByText('LFO 1').closest('button');
        expect(lfo1Pill).not.toBeNull();

        fireEvent.dragStart(lfo1Pill as HTMLElement, { dataTransfer });

        expect(setData).toHaveBeenCalledWith(BACTERIA_MOD_SOURCE_DRAG_TYPE, 'lfo1');
    });
});
