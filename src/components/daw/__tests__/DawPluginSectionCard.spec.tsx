import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { DawPluginSectionCard } from '../DawPluginSectionCard';

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

    it('should render detail in sr-only when detailMode is hidden', () => {
        render(
            <DawPluginSectionCard title="Filter" detail="LP">
                child
            </DawPluginSectionCard>
        );
        expect(screen.getByText('LP')).toHaveClass('sr-only');
    });

    it('should not use sr-only for detail when detailMode is badge', () => {
        render(
            <DawPluginSectionCard title="Filter" detail="LP" detailMode="badge">
                child
            </DawPluginSectionCard>
        );
        expect(screen.getByText('LP')).not.toHaveClass('sr-only');
    });

    it('should merge custom className with default section classes', () => {
        render(
            <DawPluginSectionCard title="T" className="custom-wrap" data-testid="card">
                c
            </DawPluginSectionCard>
        );
        expect(screen.getByTestId('card')).toHaveClass('flex', 'flex-col', 'gap-3', 'p-3', 'custom-wrap');
    });

    it('should apply titleClassName to the title', () => {
        render(
            <DawPluginSectionCard title="Title" titleClassName="title-extra">
                c
            </DawPluginSectionCard>
        );
        expect(screen.getByText('Title')).toHaveClass('title-extra');
    });

    it('should apply detailClassName to detail in badge mode', () => {
        render(
            <DawPluginSectionCard title="T" detail="D" detailMode="badge" detailClassName="detail-extra">
                c
            </DawPluginSectionCard>
        );
        expect(screen.getByText('D')).toHaveClass('detail-extra');
    });
});
