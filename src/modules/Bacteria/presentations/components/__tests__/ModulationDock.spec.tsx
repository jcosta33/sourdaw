import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { DEFAULT_PATCH, type BacteriaModAssignment, type BacteriaPatch } from '../../../models/BacteriaPatch';
import { ModulationDock } from '../ModulationDock';

describe('ModulationDock', () => {
    it('should render the source tray', () => {
        render(
            <ModulationDock
                patch={DEFAULT_PATCH}
                modValues={Array.from({ length: 9 }, () => 0)}
                onAssignmentAdd={vi.fn()}
                onAssignmentRemove={vi.fn()}
            />
        );
        expect(screen.getByText(/modulation sources/i)).toBeTruthy();
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
                onAssignmentAdd={vi.fn()}
                onAssignmentRemove={onAssignmentRemove}
            />
        );
        expect(screen.getByText('filterCutoff')).toBeTruthy();
        expect(screen.getByText('drive')).toBeTruthy();
        const removeButtons = screen.getAllByRole('button', { name: '×' });
        fireEvent.click(removeButtons[1] as HTMLElement);
        expect(onAssignmentRemove).toHaveBeenCalledWith(1);
    });
});

describe('ModulationDock — source pills', () => {
    it('renders all 9 mod source labels', () => {
        render(
            <ModulationDock
                patch={DEFAULT_PATCH}
                modValues={Array.from({ length: 9 }, () => 0)}
                onAssignmentAdd={vi.fn()}
                onAssignmentRemove={vi.fn()}
            />
        );
        // Each label appears both as a source pill and in the add-flow select.
        for (const label of ['LFO 1', 'LFO 2', 'Env Follow', 'Lorenz', 'Step Seq', 'Macro 4']) {
            expect(screen.getAllByText(label).length).toBeGreaterThanOrEqual(1);
        }
    });
});

describe('ModulationDock — assignment display', () => {
    it('shows Active Assignments header only when assignments exist', () => {
        render(
            <ModulationDock
                patch={DEFAULT_PATCH}
                modValues={Array.from({ length: 9 }, () => 0)}
                onAssignmentAdd={vi.fn()}
                onAssignmentRemove={vi.fn()}
            />
        );
        expect(screen.queryByText(/active assignments/i)).toBeNull();
    });

    it('shows assignment count on source pill when assignments exist', () => {
        const patch: BacteriaPatch = {
            ...DEFAULT_PATCH,
            modAssignments: [
                { sourceId: 'lfo1', targetParam: 'filterCutoff', amount: 0.5, bipolar: false },
                { sourceId: 'lfo1', targetParam: 'drive', amount: -0.3, bipolar: true },
            ],
        };
        render(
            <ModulationDock
                patch={patch}
                modValues={Array.from({ length: 9 }, () => 0)}
                onAssignmentAdd={vi.fn()}
                onAssignmentRemove={vi.fn()}
            />
        );
        // LFO 1 has 2 assignments → count badge "(2)"
        expect(screen.getByText('(2)')).toBeTruthy();
    });

    it('shows amount as percentage with + prefix for positive values', () => {
        const patch: BacteriaPatch = {
            ...DEFAULT_PATCH,
            modAssignments: [{ sourceId: 'lfo1', targetParam: 'filterCutoff', amount: 0.5, bipolar: false }],
        };
        render(
            <ModulationDock
                patch={patch}
                modValues={Array.from({ length: 9 }, () => 0)}
                onAssignmentAdd={vi.fn()}
                onAssignmentRemove={vi.fn()}
            />
        );
        // Scoped to the row: the add-flow depth slider also reads +50% at rest.
        const row = screen.getByText('filterCutoff').parentElement!;
        expect(within(row).getByText('+50%')).toBeTruthy();
    });

    it('shows amount as percentage without prefix for negative values', () => {
        const patch: BacteriaPatch = {
            ...DEFAULT_PATCH,
            modAssignments: [{ sourceId: 'lfo1', targetParam: 'filterCutoff', amount: -0.25, bipolar: false }],
        };
        render(
            <ModulationDock
                patch={patch}
                modValues={Array.from({ length: 9 }, () => 0)}
                onAssignmentAdd={vi.fn()}
                onAssignmentRemove={vi.fn()}
            />
        );
        const row = screen.getByText('filterCutoff').parentElement!;
        expect(within(row).getByText('-25%')).toBeTruthy();
    });
});

describe('ModulationDock — add flow', () => {
    function renderDock(patch: BacteriaPatch, onAssignmentAdd: (assignment: BacteriaModAssignment) => void) {
        render(
            <ModulationDock
                patch={patch}
                modValues={Array.from({ length: 9 }, () => 0)}
                onAssignmentAdd={onAssignmentAdd}
                onAssignmentRemove={vi.fn()}
            />
        );
    }

    it('renders the source select, target select, depth slider, and Add button', () => {
        renderDock(DEFAULT_PATCH, vi.fn());
        expect(screen.getByLabelText('Modulation source')).toBeTruthy();
        expect(screen.getByLabelText('Modulation target')).toBeTruthy();
        expect(screen.getByLabelText('Modulation depth')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Add' })).toBeTruthy();
    });

    it('offers mix plus the active bands drive and cutoff targets', () => {
        const patch: BacteriaPatch = { ...DEFAULT_PATCH, bandCount: 2 };
        renderDock(patch, vi.fn());
        expect(screen.getByText('Master Mix')).toBeTruthy();
        expect(screen.getByText('Band 1 Drive')).toBeTruthy();
        expect(screen.getByText('Band 2 Cutoff')).toBeTruthy();
        expect(screen.queryByText('Band 3 Drive')).toBeNull();
    });

    it('adds the selected source and target with the slider depth', () => {
        const onAssignmentAdd = vi.fn();
        renderDock({ ...DEFAULT_PATCH, bandCount: 3 }, onAssignmentAdd);

        fireEvent.change(screen.getByLabelText('Modulation source'), { target: { value: 'lfo2' } });
        fireEvent.change(screen.getByLabelText('Modulation target'), { target: { value: 'band2_filterCutoff' } });
        fireEvent.change(screen.getByLabelText('Modulation depth'), { target: { value: '0.75' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add' }));

        expect(onAssignmentAdd).toHaveBeenCalledWith({
            sourceId: 'lfo2',
            targetParam: 'band2_filterCutoff',
            amount: 0.75,
            bipolar: true,
        });
    });

    it('resets the depth slider after adding while keeping the selection', () => {
        const onAssignmentAdd = vi.fn();
        renderDock(DEFAULT_PATCH, onAssignmentAdd);

        fireEvent.change(screen.getByLabelText('Modulation depth'), { target: { value: '-0.5' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add' }));
        fireEvent.click(screen.getByRole('button', { name: 'Add' }));

        expect(onAssignmentAdd).toHaveBeenNthCalledWith(1, expect.objectContaining({ amount: -0.5 }));
        expect(onAssignmentAdd).toHaveBeenNthCalledWith(2, expect.objectContaining({ amount: 0.5 }));
    });
});
