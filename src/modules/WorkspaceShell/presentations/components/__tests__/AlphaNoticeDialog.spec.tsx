import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { AlphaNoticeDialog } from '../AlphaNoticeDialog';

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

    it('shows the alpha version label', () => {
        render(<AlphaNoticeDialog open onOpenChange={vi.fn()} />);
        expect(screen.getByText(/Alpha Version 0\.1\.0/)).toBeInTheDocument();
    });

    it('renders the Discord join button', () => {
        const windowOpen = vi.spyOn(window, 'open').mockImplementation(() => null);
        render(<AlphaNoticeDialog open onOpenChange={vi.fn()} />);

        const discordBtn = screen.getByRole('button', { name: /Join the Bakery/ });
        fireEvent.click(discordBtn);

        expect(windowOpen).toHaveBeenCalledWith('https://discord.gg/bJHmmfY4', '_blank');
        windowOpen.mockRestore();
    });

    it('renders the explanatory body text mentioning the Talk to us button', () => {
        render(<AlphaNoticeDialog open onOpenChange={vi.fn()} />);
        expect(screen.getByText(/Talk to us/)).toBeInTheDocument();
    });
});
