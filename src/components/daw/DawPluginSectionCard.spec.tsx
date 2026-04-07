import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DawPluginSectionCard } from './DawPluginSectionCard';

describe('DawPluginSectionCard', () => {
    it('should show detail in badge mode', () => {
        render(
            <DawPluginSectionCard title="Filter" detail="LP" detailMode="badge">
                child
            </DawPluginSectionCard>
        );
        expect(screen.getByText('Filter')).toBeInTheDocument();
        expect(screen.getByText('LP')).toBeInTheDocument();
        expect(screen.getByText('child')).toBeInTheDocument();
    });
});
