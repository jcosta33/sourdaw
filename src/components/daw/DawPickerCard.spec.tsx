import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DawPickerCard } from './DawPickerCard';

describe('DawPickerCard', () => {
    it('should render media heading description meta action', () => {
        render(
            <DawPickerCard
                media={<div data-testid="med">img</div>}
                heading="Pack"
                meta={<span>m</span>}
                description="desc"
                action={<button type="button">go</button>}
            />
        );
        expect(screen.getByTestId('med')).toBeInTheDocument();
        expect(screen.getByText('Pack')).toBeInTheDocument();
        expect(screen.getByText('desc')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'go' })).toBeInTheDocument();
    });
});
