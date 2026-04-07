import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FilterSection } from './FilterSection';
import { DEFAULT_PATCH } from '../../models/FermenterPatch';

describe('FilterSection', () => {
    it('should render', () => {
        const p = DEFAULT_PATCH;
        render(
            <FilterSection
                model={p.filterModel}
                cutoff={p.filterCutoff}
                resonance={p.filterResonance}
                mode={p.filterMode}
                envAmount={p.filterEnvAmount}
                drive={p.filterDrive}
                keytrack={p.filterKeytrack}
                onModelChange={vi.fn()}
                onCutoffChange={vi.fn()}
                onResonanceChange={vi.fn()}
                onModeChange={vi.fn()}
                onEnvAmountChange={vi.fn()}
                onDriveChange={vi.fn()}
                onKeytrackChange={vi.fn()}
            />
        );
        expect(screen.getByText(/filter/i)).toBeInTheDocument();
    });
});
