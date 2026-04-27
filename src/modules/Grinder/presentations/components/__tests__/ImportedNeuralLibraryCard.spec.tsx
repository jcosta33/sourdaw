import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ImportedNeuralLibraryCard } from '../ImportedNeuralLibraryCard';

const base_entry = {
    id: 'imported-tight-rhythm',
    source: 'imported' as const,
    name: 'Tight Rhythm',
    family: 'NAM import',
    placement: 'amp-capture' as const,
    description: 'Imported from tight-rhythm.nam',
    importedAt: 1,
    sourceFileName: 'tight-rhythm.nam',
    sourceFileText: '{"name":"tight"}',
    profile: {
        derivedFrom: 'nam' as const,
        sourceArchitecture: 'WaveNet',
        sourceSampleRate: 48_000,
        sourceWeightCount: 12,
        preferredTier: 'standard' as const,
        inputDrive: 1.18,
        asymmetry: 0.04,
        outputTrim: 0.9,
        contourMix: 0.22,
        recurrentBias: 0.02,
        convWeights: [
            [0.1, 0.7, 0.2],
            [0.09, 0.68, 0.23],
            [0.12, 0.66, 0.2],
            [0.11, 0.67, 0.19],
            [0.08, 0.72, 0.16],
            [0.07, 0.74, 0.15],
            [0.13, 0.64, 0.19],
            [0.1, 0.69, 0.18],
            [0.09, 0.7, 0.17],
            [0.11, 0.68, 0.17],
        ],
    },
};

describe('ImportedNeuralLibraryCard', () => {
    it('should render export and remove actions for a reusable imported capture', () => {
        render(
            <ImportedNeuralLibraryCard
                entry={base_entry}
                selected={false}
                on_select={vi.fn()}
                on_export={vi.fn()}
                on_remove={vi.fn()}
            />
        );

        expect(screen.getByText('Tight Rhythm')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /export nam/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /remove capture/i })).toBeInTheDocument();
    });

    it('should expose a patch-only badge when the original library source is gone', () => {
        render(
            <ImportedNeuralLibraryCard
                entry={{
                    ...base_entry,
                    sourceFileName: null,
                    sourceFileText: null,
                    importedAt: 0,
                    description: 'Selected in this patch',
                }}
                selected={true}
                on_select={vi.fn()}
                on_export={vi.fn()}
                on_remove={vi.fn()}
            />
        );

        expect(screen.getByText('Patch only')).toBeInTheDocument();
    });

    it('should forward select, export, and remove actions', () => {
        const on_select = vi.fn();
        const on_export = vi.fn();
        const on_remove = vi.fn();
        render(
            <ImportedNeuralLibraryCard
                entry={base_entry}
                selected={false}
                on_select={on_select}
                on_export={on_export}
                on_remove={on_remove}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: /tight rhythm/i }));
        fireEvent.click(screen.getByRole('button', { name: /export nam/i }));
        fireEvent.click(screen.getByRole('button', { name: /remove capture/i }));

        expect(on_select).toHaveBeenCalledWith(base_entry);
        expect(on_export).toHaveBeenCalledWith(base_entry);
        expect(on_remove).toHaveBeenCalledWith(base_entry);
    });
});
