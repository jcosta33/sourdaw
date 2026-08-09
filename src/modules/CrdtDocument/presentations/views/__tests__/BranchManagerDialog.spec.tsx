import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { BranchManagerDialog } from '../BranchManagerDialog';

const mocks = vi.hoisted(() => ({
    useStore: vi.fn(),
    deleteBranch: vi.fn(),
    switchBranch: vi.fn(() => Promise.resolve()),
    mergeBranch: vi.fn(() => Promise.resolve()),
    forkProjectBranch: vi.fn(() => Promise.resolve()),
}));

vi.mock('#/infra/store/useStore', () => ({
    useStore: mocks.useStore,
}));
vi.mock('../../../useCases/crdtBranching/deleteBranch', () => ({ deleteBranch: mocks.deleteBranch }));
vi.mock('../../../useCases/crdtBranching/switchBranch', () => ({ switchBranch: mocks.switchBranch }));
vi.mock('../../../useCases/crdtBranching/mergeBranch', () => ({ mergeBranch: mocks.mergeBranch }));
vi.mock('../../../useCases/crdtBranching/forkProjectBranch', () => ({ forkProjectBranch: mocks.forkProjectBranch }));

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
        mocks.deleteBranch.mockReset();
        mocks.switchBranch.mockReset().mockResolvedValue(undefined);
        mocks.mergeBranch.mockReset().mockResolvedValue(undefined);
        mocks.forkProjectBranch.mockReset().mockResolvedValue(undefined);
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

    /**
     * Every branch operation could fail silently before #1557: all four caught
     * into `logger.warn` and the dialog rendered nothing, so under a sealed
     * `localStorage` the whole surface was a no-op with no explanation. These
     * assert the message reaches the DOM and clears, not that a `catch` exists.
     */
    describe('reporting a failed operation', () => {
        it('shows nothing until an operation fails', () => {
            render(<BranchManagerDialog onClose={vi.fn()} />);

            expect(screen.queryByRole('alert')).toBeNull();
        });

        it('surfaces a failed delete instead of leaving the row silently unchanged', () => {
            mocks.deleteBranch.mockImplementationOnce(() => {
                throw new Error('Could not save the branch list');
            });
            render(<BranchManagerDialog onClose={vi.fn()} />);

            fireEvent.click(screen.getByRole('button', { name: 'Delete branch Feature X' }));

            expect(screen.getByRole('alert').textContent).toContain('Could not delete branch "Feature X"');
            // The row is still there — which is exactly why the message matters.
            expect(screen.getByRole('button', { name: 'Switch to branch Feature X' })).toBeTruthy();
        });

        it('surfaces a failed merge', async () => {
            mocks.mergeBranch.mockRejectedValueOnce(new Error('merge failed'));
            render(<BranchManagerDialog onClose={vi.fn()} />);

            fireEvent.click(screen.getByRole('button', { name: 'Merge branch Feature X into current branch' }));

            expect((await screen.findByRole('alert')).textContent).toContain('Could not merge branch "Feature X"');
        });

        it('surfaces a failed switch', async () => {
            mocks.switchBranch.mockRejectedValueOnce(new Error('switch failed'));
            render(<BranchManagerDialog onClose={vi.fn()} />);

            fireEvent.click(screen.getByRole('button', { name: 'Switch to branch Feature X' }));

            expect((await screen.findByRole('alert')).textContent).toContain('Could not switch to branch "Feature X"');
        });

        it('surfaces a failed fork', async () => {
            mocks.forkProjectBranch.mockRejectedValueOnce(new Error('fork failed'));
            render(<BranchManagerDialog onClose={vi.fn()} />);

            fireEvent.change(screen.getByPlaceholderText('New branch name'), { target: { value: 'next' } });
            fireEvent.click(screen.getByRole('button', { name: /Fork/ }));

            expect((await screen.findByRole('alert')).textContent).toContain('Could not create branch "next"');
        });

        it('re-announces on a repeat failure of the same operation', async () => {
            // `setOperationError(null)` then `setOperationError(message)` batch
            // into one render, so identical text produced zero DOM mutations and
            // the alert was announced once and never again. Observed directly:
            // a screen reader has nothing to go on but the mutation.
            mocks.deleteBranch.mockImplementation(() => {
                throw new Error('Could not save the branch list');
            });
            render(<BranchManagerDialog onClose={vi.fn()} />);
            const deleteButton = screen.getByRole('button', { name: 'Delete branch Feature X' });

            fireEvent.click(deleteButton);
            const alertParent = screen.getByRole('alert').parentElement;
            if (!alertParent) {
                throw new Error('Expected the alert to be mounted inside the dialog body');
            }

            // Collected from both delivery paths: the callback drains the queue
            // at the microtask checkpoint, so `takeRecords` alone would come
            // back empty after an await and pass for the wrong reason.
            const mutations: MutationRecord[] = [];
            const observer = new MutationObserver((records) => mutations.push(...records));
            observer.observe(alertParent, { childList: true, subtree: true, characterData: true });

            fireEvent.click(deleteButton);
            await Promise.resolve();
            mutations.push(...observer.takeRecords());
            observer.disconnect();

            expect(mutations.length).toBeGreaterThan(0);
            expect(screen.getByRole('alert').textContent).toContain('Could not delete branch "Feature X"');
        });

        it('names the branch the failure belongs to, not just the operation', () => {
            mocks.deleteBranch.mockImplementationOnce(() => {
                throw new Error('Could not save the branch list');
            });
            render(<BranchManagerDialog onClose={vi.fn()} />);

            fireEvent.click(screen.getByRole('button', { name: 'Delete branch Feature X' }));

            const message = screen.getByRole('alert').textContent;
            expect(message).toContain('"Feature X"');
            // ...and an action, so the message is not just a statement of loss.
            expect(message).toContain('try again');
        });

        it('clears the message when the next operation succeeds', () => {
            mocks.deleteBranch.mockImplementationOnce(() => {
                throw new Error('Could not save the branch list');
            });
            render(<BranchManagerDialog onClose={vi.fn()} />);

            fireEvent.click(screen.getByRole('button', { name: 'Delete branch Feature X' }));
            expect(screen.getByRole('alert').textContent).toContain('Could not delete branch "Feature X"');

            fireEvent.click(screen.getByRole('button', { name: 'Delete branch Feature X' }));

            expect(screen.queryByRole('alert')).toBeNull();
        });
    });
});
