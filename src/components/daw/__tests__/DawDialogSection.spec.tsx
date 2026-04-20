import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { DawDialogSection } from '../DawDialogSection';

describe('DawDialogSection', () => {
    it('should render title detail actions and body', () => {
        render(
            <DawDialogSection title="Export" detail="WAV" actions={<span data-testid="act">ok</span>}>
                <p>Content</p>
            </DawDialogSection>
        );
        expect(screen.getByText('Export')).toBeInTheDocument();
        expect(screen.getByText('WAV')).toBeInTheDocument();
        expect(screen.getByTestId('act')).toBeInTheDocument();
        expect(screen.getByText('Content')).toBeInTheDocument();
    });
});
