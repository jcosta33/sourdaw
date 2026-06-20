import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { CollaborationStatusRow } from '../CollaborationStatusRow';

describe('CollaborationStatusRow', () => {
    it('should render', () => {
        render(<CollaborationStatusRow icon={<span data-testid="ico">i</span>} label="Connected" tone="muted" />);
        expect(screen.getByTestId('ico')).toBeInTheDocument();
        expect(screen.getByText('Connected')).toBeInTheDocument();
    });

    it('exposes a live status region so AT announces connection changes', () => {
        render(<CollaborationStatusRow icon={<span>i</span>} label="Connecting..." />);
        const status = screen.getByRole('status');
        expect(status).toHaveAttribute('aria-live', 'polite');
        expect(status).toHaveTextContent('Connecting...');
    });
});
