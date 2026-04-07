import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DawUtilitySection } from './DawUtilitySection';

describe('DawUtilitySection', () => {
    it('should render header and body', () => {
        render(
            <DawUtilitySection title="Inputs" detail="2" actions={<button type="button">add</button>}>
                body
            </DawUtilitySection>
        );
        expect(screen.getByText('Inputs')).toBeInTheDocument();
        expect(screen.getByText('2')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'add' })).toBeInTheDocument();
        expect(screen.getByText('body')).toBeInTheDocument();
    });
});
