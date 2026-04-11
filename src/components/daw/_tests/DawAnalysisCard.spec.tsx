import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DawAnalysisCard } from '../DawAnalysisCard';

describe('DawAnalysisCard', () => {
    it('should render title detail footer and children', () => {
        render(
            <DawAnalysisCard title="Spectrum" detail="Live" footer={<span>ft</span>}>
                <span>body</span>
            </DawAnalysisCard>
        );
        expect(screen.getByRole('heading', { name: 'Spectrum' })).toBeInTheDocument();
        expect(screen.getByText('Live')).toBeInTheDocument();
        expect(screen.getByText('body')).toBeInTheDocument();
        expect(screen.getByText('ft')).toBeInTheDocument();
    });
});
