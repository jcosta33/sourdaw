import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QrInvite } from './QrInvite';

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

    it('should render Copy Invite button', () => {
        render(<QrInvite inviteString={mockInviteString} />);
        expect(screen.getByText(/Copy Invite/i)).toBeInTheDocument();
    });

    it('should copy invite string when button is clicked', async () => {
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
});
