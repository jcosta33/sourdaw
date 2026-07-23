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

    it('applies danger styling for tone="danger"', () => {
        render(<CollaborationStatusRow icon={<span>i</span>} label="Connection error" tone="danger" />);
        const status = screen.getByRole('status');
        expect(status.className).toContain('color-state-danger');
    });

    it('renders an end slot when provided', () => {
        render(
            <CollaborationStatusRow
                icon={<span>i</span>}
                label="Connected"
                endSlot={<span data-testid="end-slot">extra</span>}
            />
        );
        expect(screen.getByTestId('end-slot')).toBeInTheDocument();
    });

    it('omits the end slot wrapper when none is provided', () => {
        const { container } = render(<CollaborationStatusRow icon={<span>i</span>} label="Connected" />);
        // icon wrapper + label wrapper only — no third shrink-0 wrapper for endSlot.
        expect(container.querySelectorAll('.shrink-0')).toHaveLength(1);
    });
});
