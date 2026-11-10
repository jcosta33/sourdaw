import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../dialog';

describe('Dialog', () => {
    it('should render dialog content when open', () => {
        render(
            <Dialog open>
                <DialogContent showCloseButton={false} aria-describedby={undefined}>
                    <DialogHeader>
                        <DialogTitle>Hello</DialogTitle>
                        <DialogDescription>Details here</DialogDescription>
                    </DialogHeader>
                    <p>Body</p>
                    <DialogFooter>Actions</DialogFooter>
                </DialogContent>
            </Dialog>
        );
        expect(screen.getByText('Hello')).toBeInTheDocument();
        expect(screen.getByText('Details here')).toBeInTheDocument();
        expect(screen.getByText('Body')).toBeInTheDocument();
        expect(screen.getByText('Actions')).toBeInTheDocument();
    });

    it('provides a viewport-bounded workspace size for complex settings surfaces', () => {
        render(
            <Dialog open>
                <DialogContent size="workspace" showCloseButton={false} aria-describedby={undefined}>
                    <DialogTitle>Preferences</DialogTitle>
                </DialogContent>
            </Dialog>
        );

        const dialog = screen.getByRole('dialog');
        expect(dialog).toHaveClass(
            'h-[680px]',
            'max-h-[calc(100dvh-4rem)]',
            'w-[920px]',
            'max-w-[calc(100vw-4rem)]',
            'sm:max-w-[calc(100vw-4rem)]',
            'overflow-hidden'
        );
        expect(dialog).not.toHaveClass('sm:max-w-lg');
    });
});

describe('Dialog focus return', () => {
    const Harness = ({ open, children }: { open: boolean; children?: React.ReactNode }) => (
        <>
            {children}
            <Dialog open={open}>
                <DialogContent showCloseButton={false} aria-describedby={undefined}>
                    <DialogTitle>Opened by a flag</DialogTitle>
                    <button type="button">Inside</button>
                </DialogContent>
            </Dialog>
            <main data-focus-landmark="" tabIndex={-1}>
                Workspace
            </main>
        </>
    );

    it('returns focus to the element that had it when no trigger exists', async () => {
        const opener = <button type="button">Opener</button>;
        const { rerender } = render(<Harness open={false}>{opener}</Harness>);
        screen.getByRole('button', { name: 'Opener' }).focus();

        rerender(<Harness open>{opener}</Harness>);
        await waitFor(() => {
            expect(screen.getByRole('button', { name: 'Inside' })).toHaveFocus();
        });
        rerender(<Harness open={false}>{opener}</Harness>);

        await waitFor(() => {
            expect(screen.getByRole('button', { name: 'Opener' })).toHaveFocus();
        });
    });

    it('returns to the trigger of the menu the opener lived in when that item is gone', async () => {
        const menu = (
            <>
                <button type="button" id="menu-trigger">
                    Menu trigger
                </button>
                <div role="menu" aria-labelledby="menu-trigger">
                    <button type="button" role="menuitem">
                        Item
                    </button>
                </div>
            </>
        );
        const { rerender } = render(<Harness open={false}>{menu}</Harness>);
        screen.getByRole('menuitem', { name: 'Item' }).focus();

        rerender(<Harness open>{menu}</Harness>);
        await waitFor(() => {
            expect(screen.getByRole('button', { name: 'Inside' })).toHaveFocus();
        });
        rerender(
            <Harness open>
                <button type="button" id="menu-trigger">
                    Menu trigger
                </button>
            </Harness>
        );
        rerender(
            <Harness open={false}>
                <button type="button" id="menu-trigger">
                    Menu trigger
                </button>
            </Harness>
        );

        await waitFor(() => {
            expect(screen.getByRole('button', { name: 'Menu trigger' })).toHaveFocus();
        });
    });

    it('falls back to the workspace landmark when the opener and its menu are gone', async () => {
        const { rerender } = render(
            <Harness open={false}>
                <button type="button">Transient</button>
            </Harness>
        );
        screen.getByRole('button', { name: 'Transient' }).focus();

        rerender(
            <Harness open>
                <button type="button">Transient</button>
            </Harness>
        );
        await waitFor(() => {
            expect(screen.getByRole('button', { name: 'Inside' })).toHaveFocus();
        });
        rerender(<Harness open />);
        rerender(<Harness open={false} />);

        await waitFor(() => {
            expect(screen.getByText('Workspace')).toHaveFocus();
        });
    });

    it('does not strand focus on body when the opener became disabled while the dialog was open', async () => {
        const ui = (disabled: boolean, open: boolean) => (
            <Harness open={open}>
                <button type="button" disabled={disabled}>
                    Opener
                </button>
            </Harness>
        );
        const { rerender } = render(ui(false, false));
        screen.getByRole('button', { name: 'Opener' }).focus();

        rerender(ui(false, true));
        await waitFor(() => {
            expect(screen.getByRole('button', { name: 'Inside' })).toHaveFocus();
        });
        rerender(ui(true, true));
        rerender(ui(true, false));

        await waitFor(() => {
            expect(screen.getByText('Workspace')).toHaveFocus();
        });
    });
});
