import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DawEmptyState } from '../DawEmptyState';

describe('DawEmptyState', () => {
    it('should render title and optional description', () => {
        render(<DawEmptyState title="Nothing here" description="Add items" />);
        expect(screen.getByText('Nothing here')).toBeInTheDocument();
        expect(screen.getByText('Add items')).toBeInTheDocument();
    });

    it('should render icon and action slots', () => {
        render(
            <DawEmptyState
                title="T"
                icon={<span data-testid="ico">icon</span>}
                action={<button type="button">Go</button>}
            />
        );
        expect(screen.getByTestId('ico')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Go' })).toBeInTheDocument();
    });
});
