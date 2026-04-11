import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InviteCodeRow } from '../InviteCodeRow';

describe('InviteCodeRow', () => {
    it('should render', () => {
        const onCopy = vi.fn();
        render(<InviteCodeRow value="abc-123" copied={false} onCopy={onCopy} />);
        fireEvent.click(screen.getByRole('button'));
        expect(onCopy).toHaveBeenCalled();
    });
});
