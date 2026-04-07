import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AlphaNoticeDialog } from './AlphaNoticeDialog';

describe('AlphaNoticeDialog', () => {
    it('should render welcome content when open', () => {
        const onOpenChange = vi.fn();
        render(<AlphaNoticeDialog open onOpenChange={onOpenChange} />);
        expect(screen.getByText(/Welcome to the/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Let me cook/ })).toBeInTheDocument();
    });

    it('should call onOpenChange(false) when dismissing', () => {
        const onOpenChange = vi.fn();
        render(<AlphaNoticeDialog open onOpenChange={onOpenChange} />);
        fireEvent.click(screen.getByRole('button', { name: /Let me cook/ }));
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });
});
