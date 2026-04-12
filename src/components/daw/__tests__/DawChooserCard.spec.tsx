import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DawChooserCard } from '../DawChooserCard';

describe('DawChooserCard', () => {
    it('should render slots and handle click', () => {
        const onClick = vi.fn();
        render(
            <DawChooserCard
                title="Option A"
                description="Desc"
                startSlot={<span data-testid="s">i</span>}
                badge={<span data-testid="b">new</span>}
                onClick={onClick}
            />
        );
        expect(screen.getByText('Option A')).toBeInTheDocument();
        expect(screen.getByText('Desc')).toBeInTheDocument();
        expect(screen.getByTestId('s')).toBeInTheDocument();
        expect(screen.getByTestId('b')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button'));
        expect(onClick).toHaveBeenCalled();
    });
});
