import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DawPluginInsetCard } from '../DawPluginInsetCard';

describe('DawPluginInsetCard', () => {
    it('should render header and children', () => {
        render(
            <DawPluginInsetCard title="Section" actions={<span data-testid="a">+</span>}>
                body
            </DawPluginInsetCard>
        );
        expect(screen.getByText('Section')).toBeInTheDocument();
        expect(screen.getByTestId('a')).toBeInTheDocument();
        expect(screen.getByText('body')).toBeInTheDocument();
    });
});
