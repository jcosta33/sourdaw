import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DawBlockedState } from '../DawBlockedState';

describe('DawBlockedState', () => {
    it('should render eyebrow title description summary and action', () => {
        render(
            <DawBlockedState
                eyebrow="Locked"
                title="No access"
                description="Reason"
                summary={<span data-testid="sum">Details</span>}
                action={<button type="button">OK</button>}
            />
        );
        expect(screen.getByText('Locked')).toBeInTheDocument();
        expect(screen.getByText('No access')).toBeInTheDocument();
        expect(screen.getByText('Reason')).toBeInTheDocument();
        expect(screen.getByTestId('sum')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'OK' })).toBeInTheDocument();
    });
});
