import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { InviteCodeRow } from '../InviteCodeRow';

describe('InviteCodeRow', () => {
    it('should render', () => {
        const onCopy = vi.fn();
        render(<InviteCodeRow value="abc-123" copied={false} onCopy={onCopy} />);
        fireEvent.click(screen.getByRole('button'));
        expect(onCopy).toHaveBeenCalled();
    });

    it('exposes the full invite to AT even when the visible text is truncated', () => {
        const fullInvite = 'x'.repeat(60);
        const { container } = render(<InviteCodeRow value={fullInvite} copied={false} onCopy={vi.fn()} />);
        const code = container.querySelector('code');
        // Visible text is clipped to 40 chars + ellipsis...
        expect(code?.textContent).toBe(`${'x'.repeat(40)}...`);
        // ...but the accessible name carries the complete string.
        expect(code).toHaveAttribute('aria-label', fullInvite);
    });
});
