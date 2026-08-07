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
                onAssignmentRemove={vi.fn()}
            />
        );
        expect(screen.getByText('LFO 1')).toBeTruthy();
        expect(screen.getByText('LFO 2')).toBeTruthy();
        expect(screen.getByText('Env Follow')).toBeTruthy();
        expect(screen.getByText('Lorenz')).toBeTruthy();
        expect(screen.getByText('Step Seq')).toBeTruthy();
        expect(screen.getByText('Macro 4')).toBeTruthy();
    });
});

describe('ModulationDock — assignment display', () => {
    it('shows Active Assignments header only when assignments exist', () => {
        render(
            <ModulationDock
                patch={DEFAULT_PATCH}
                modValues={Array.from({ length: 9 }, () => 0)}
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
            <ModulationDock patch={patch} modValues={Array.from({ length: 9 }, () => 0)} onAssignmentRemove={vi.fn()} />
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
            <ModulationDock patch={patch} modValues={Array.from({ length: 9 }, () => 0)} onAssignmentRemove={vi.fn()} />
        );
        expect(screen.getByText('+50%')).toBeTruthy();
    });

    it('shows amount as percentage without prefix for negative values', () => {
        const patch: BacteriaPatch = {
            ...DEFAULT_PATCH,
            modAssignments: [{ sourceId: 'lfo1', targetParam: 'filterCutoff', amount: -0.25, bipolar: false }],
        };
        render(
            <ModulationDock patch={patch} modValues={Array.from({ length: 9 }, () => 0)} onAssignmentRemove={vi.fn()} />
        );
        expect(screen.getByText('-25%')).toBeTruthy();
    });
});
