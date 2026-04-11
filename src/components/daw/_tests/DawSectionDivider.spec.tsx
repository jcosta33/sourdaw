import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DawSectionDivider } from '../DawSectionDivider';

describe('DawSectionDivider', () => {
    it('should render label and optional start slot', () => {
        render(
            <DawSectionDivider label="Filters" startSlot={<span data-testid="slot">*</span>} />
        );
        expect(screen.getByText('Filters')).toBeInTheDocument();
        expect(screen.getByTestId('slot')).toBeInTheDocument();
    });
});
