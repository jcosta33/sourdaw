import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { InspectorDetailHeader } from '../InspectorDetailHeader';

describe('InspectorDetailHeader — back button', () => {
    it('calls onBack when back button clicked', () => {
        const onBack = vi.fn();
        render(<InspectorDetailHeader title="My Panel" onBack={onBack} backLabel="Go back" />);
        fireEvent.click(screen.getByRole('button', { name: 'Go back' }));
        expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('back button aria-label matches backLabel', () => {
        render(<InspectorDetailHeader title="X" onBack={vi.fn()} backLabel="Return to list" />);
        expect(screen.getByRole('button', { name: 'Return to list' })).toBeInTheDocument();
    });
});

describe('InspectorDetailHeader — title rendering', () => {
    it('renders string title', () => {
        render(<InspectorDetailHeader title="EQ Settings" onBack={vi.fn()} backLabel="Back" />);
        expect(screen.getByText('EQ Settings')).toBeInTheDocument();
    });

    it('renders ReactNode title', () => {
        render(
            <InspectorDetailHeader
                title={<span data-testid="custom-title">Custom</span>}
                onBack={vi.fn()}
                backLabel="Back"
            />
        );
        expect(screen.getByTestId('custom-title')).toBeInTheDocument();
    });
});

describe('InspectorDetailHeader — optional actions slot', () => {
    it('renders actions when provided', () => {
        render(
            <InspectorDetailHeader
                title="Panel"
                onBack={vi.fn()}
                backLabel="Back"
                actions={
                    <button type="button" data-testid="action-btn">
                        Action
                    </button>
                }
            />
        );
        expect(screen.getByTestId('action-btn')).toBeInTheDocument();
    });

    it('does not render actions when not provided', () => {
        render(<InspectorDetailHeader title="Panel" onBack={vi.fn()} backLabel="Back" />);
        // No extra buttons beyond the back button
        expect(screen.getAllByRole('button')).toHaveLength(1);
    });
});
