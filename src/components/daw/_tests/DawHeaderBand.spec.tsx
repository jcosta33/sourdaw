import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DawHeaderBand } from '../DawHeaderBand';

describe('DawHeaderBand', () => {
    it('should render children only when no title actions or startSlot', () => {
        render(
            <DawHeaderBand data-testid="band">
                <span>only</span>
            </DawHeaderBand>
        );
        expect(screen.getByTestId('band')).toHaveTextContent('only');
    });

    it('should render title actions and startSlot in row layout', () => {
        render(
            <DawHeaderBand title="Mixer" startSlot={<span data-testid="st">icon</span>} actions={<button type="button">+</button>} />
        );
        expect(screen.getByText('Mixer')).toBeInTheDocument();
        expect(screen.getByTestId('st')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '+' })).toBeInTheDocument();
    });
});
