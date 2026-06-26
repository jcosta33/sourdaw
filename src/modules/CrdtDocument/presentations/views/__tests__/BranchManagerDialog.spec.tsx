import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { BranchManagerDialog } from '../BranchManagerDialog';

const mocks = vi.hoisted(() => ({
    useStore: vi.fn(),
}));

vi.mock('#/infra/store/useStore', () => ({
    useStore: mocks.useStore,
}));

const branchState = {
    activeBranchId: 'main',
    branches: [
        {
            branchId: 'main',
            name: 'Main',
            rootDocId: 'root',
            sourceBranchId: null,
            createdAt: 0,
            createdFromHeads: [],
            note: '',
        },
        {
            branchId: 'feat',
            name: 'Feature X',
            rootDocId: 'branch_feat',
            sourceBranchId: 'main',
            createdAt: 1,
            createdFromHeads: [],
            note: '',
        },
    ],
};

describe('BranchManagerDialog', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.useStore.mockReturnValue(branchState);
    });

    it('exposes a labelled modal dialog', () => {
        render(<BranchManagerDialog onClose={vi.fn()} />);
        const dialog = screen.getByRole('dialog', { name: 'Branches' });
        expect(dialog).toHaveAttribute('aria-modal', 'true');
    });

    it('closes when Escape is pressed', () => {
        const onClose = vi.fn();
        render(<BranchManagerDialog onClose={onClose} />);

        const dialog = screen.getByRole('dialog', { name: 'Branches' });
        fireEvent.keyDown(dialog, { key: 'Escape' });

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not close on other keys', () => {
        const onClose = vi.fn();
        render(<BranchManagerDialog onClose={onClose} />);

        const dialog = screen.getByRole('dialog', { name: 'Branches' });
        fireEvent.keyDown(dialog, { key: 'Enter' });

        expect(onClose).not.toHaveBeenCalled();
    });

    it('gives the icon-only branch controls accessible names', () => {
        render(<BranchManagerDialog onClose={vi.fn()} />);

        // Non-active branch "Feature X" has merge + delete; main has neither.
        expect(screen.getByRole('button', { name: 'Merge branch Feature X into current branch' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Delete branch Feature X' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Switch to branch Feature X' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Close branch manager' })).toBeTruthy();
    });
});
