import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import QRCode from 'qrcode';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { QrInvite } from '../QrInvite';

// Mock QRCode library
vi.mock('qrcode', () => ({
    default: {
        toCanvas: vi.fn().mockResolvedValue(undefined),
    },
}));

// Mock clipboard
Object.assign(navigator, {
    clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
    },
});

describe('QrInvite', () => {
    const mockInviteString = 'test-invite-code-12345';

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<QrInvite inviteString={mockInviteString} />);
        expect(screen.getByText(/Scan to join/i)).toBeInTheDocument();
    });

    it('should display the QR code canvas', () => {
        render(<QrInvite inviteString={mockInviteString} />);
        expect(document.querySelector('canvas')).toBeInTheDocument();
    });

    it('exposes the QR canvas to AT as an image labelled with the invite', () => {
        render(<QrInvite inviteString={mockInviteString} />);
        const qr = screen.getByRole('img');
        expect(qr.tagName).toBe('CANVAS');
        expect(qr).toHaveAttribute('aria-label', expect.stringContaining(mockInviteString));
    });

    it('should render Copy Invite button', () => {
        render(<QrInvite inviteString={mockInviteString} />);
        expect(screen.getByText(/Copy Invite/i)).toBeInTheDocument();
    });

    it('should copy invite string when button is clicked', () => {
        render(<QrInvite inviteString={mockInviteString} />);
        const copyButton = screen.getByText(/Copy Invite/i);
        fireEvent.click(copyButton);
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(mockInviteString);
    });

    it('should show "Copied" text after clicking copy', () => {
        render(<QrInvite inviteString={mockInviteString} />);
        const copyButton = screen.getByText(/Copy Invite/i);
        fireEvent.click(copyButton);
        expect(screen.getByText(/Copied/i)).toBeInTheDocument();
    });

    it('should render with correct container structure', () => {
        const { container } = render(<QrInvite inviteString={mockInviteString} />);
        // Check that the component renders a container with expected content
        expect(container.firstChild).toBeTruthy();
        expect(screen.getByText(/Scan to join/i)).toBeInTheDocument();
    });

    it('does not attempt to render a QR code for an empty invite string', () => {
        render(<QrInvite inviteString="" />);
        expect(vi.mocked(QRCode.toCanvas)).not.toHaveBeenCalled();
        expect(screen.getByText(/Scan to join/i)).toBeInTheDocument();
    });

    it('falls back to a "too long" empty state when QR generation fails', async () => {
        vi.mocked(QRCode.toCanvas).mockRejectedValueOnce(new Error('data too long'));
        render(<QrInvite inviteString={mockInviteString} />);

        await waitFor(() => expect(screen.getByText('Invite too long for QR')).toBeInTheDocument());
        expect(screen.getByText('Use Copy Invite instead.')).toBeInTheDocument();
        expect(screen.queryByRole('img')).not.toBeInTheDocument();
    });

    it('still copies the invite from the "too long" fallback state', async () => {
        vi.mocked(QRCode.toCanvas).mockRejectedValueOnce(new Error('data too long'));
        render(<QrInvite inviteString={mockInviteString} />);
        await waitFor(() => expect(screen.getByText('Invite too long for QR')).toBeInTheDocument());

        fireEvent.click(screen.getByRole('button', { name: /Copy Invite/i }));

        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(mockInviteString);
        expect(screen.getByText(/Copied/i)).toBeInTheDocument();
    });

    it('reverts the copied indicator after the timeout, clearing any prior timer on rapid re-clicks', () => {
        vi.useFakeTimers();
        try {
            render(<QrInvite inviteString={mockInviteString} />);
            const copyButton = screen.getByText(/Copy Invite/i);

            fireEvent.click(copyButton);
            // Clicking again before the timeout clears the pending reset timer.
            fireEvent.click(copyButton);
            expect(screen.getByText(/Copied/i)).toBeInTheDocument();

            act(() => {
                vi.advanceTimersByTime(2000);
            });

            expect(screen.getByText(/^Copy Invite$/i)).toBeInTheDocument();
        } finally {
            vi.useRealTimers();
        }
    });

    it('clears any pending copied-reset timer on unmount without throwing', () => {
        vi.useFakeTimers();
        try {
            const { unmount } = render(<QrInvite inviteString={mockInviteString} />);
            fireEvent.click(screen.getByText(/Copy Invite/i));

            expect(() => unmount()).not.toThrow();
            expect(() => vi.advanceTimersByTime(2000)).not.toThrow();
        } finally {
            vi.useRealTimers();
        }
    });
});
