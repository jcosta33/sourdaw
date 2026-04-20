import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { CollaborationStatusRow } from '../CollaborationStatusRow';

describe('CollaborationStatusRow', () => {
    it('should render', () => {
        render(<CollaborationStatusRow icon={<span data-testid="ico">i</span>} label="Connected" tone="muted" />);
        expect(screen.getByTestId('ico')).toBeInTheDocument();
        expect(screen.getByText('Connected')).toBeInTheDocument();
    });
});
