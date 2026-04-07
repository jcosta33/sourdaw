import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ModulationSection } from './ModulationSection';
import { DEFAULT_PATCH } from '../../models/FermenterPatch';

describe('ModulationSection', () => {
    it('should render', () => {
        const p = DEFAULT_PATCH;
        render(
            <ModulationSection
                msegToFilter={p.msegToFilter}
                seqRate={p.seqRate}
                seqToPitch={p.seqToPitch}
                onParam={vi.fn()}
            />
        );
        expect(screen.getByText(/modulation/i)).toBeInTheDocument();
    });
});
