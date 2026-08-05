import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { InspectorDetailHeader } from '../InspectorDetailHeader';

describe('InspectorDetailHeader', () => {
    it('should call onBack when back is activated', () => {
        const onBack = vi.fn();
        render(<InspectorDetailHeader title="Details" onBack={onBack} backLabel="Go back to list" />);
        fireEvent.click(screen.getByRole('button', { name: 'Go back to list' }));
        expect(onBack).toHaveBeenCalledTimes(1);
    });
});

describe('InspectorDetailHeader — title and back label', () => {
    it('renders the title content', () => {
        render(<InspectorDetailHeader title="My Inspector" onBack={vi.fn()} backLabel="Back" />);
        expect(screen.getByText('My Inspector')).toBeTruthy();
    });

    it('uses backLabel as the back button aria-label', () => {
        render(<InspectorDetailHeader title="X" onBack={vi.fn()} backLabel="Return to tracks" />);
        const button = screen.getByRole('button');
        expect(button.getAttribute('aria-label')).toBe('Return to tracks');
    });
});

describe('InspectorDetailHeader — actions slot', () => {
    it('renders the actions slot when provided', () => {
        render(
            <InspectorDetailHeader
                title="X"
                onBack={vi.fn()}
                backLabel="Back"
                actions={<button type="button">Action</button>}
            />
        );
        expect(screen.getByRole('button', { name: 'Action' })).toBeTruthy();
    });

    it('omits the actions slot when not provided', () => {
        render(<InspectorDetailHeader title="X" onBack={vi.fn()} backLabel="Back" />);
        // Only the back button should exist
        expect(screen.getAllByRole('button')).toHaveLength(1);
    });
});
