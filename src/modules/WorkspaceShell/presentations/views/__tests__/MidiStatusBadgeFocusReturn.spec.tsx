import { type ReactElement, useEffect, useState } from 'react';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { Dialog, DialogContent, DialogTitle } from '#/components/ui/dialog';
import { TooltipProvider } from '#/components/ui/tooltip';

import { StatusBar } from '../StatusBar';

const preferencesOpener = vi.hoisted(() => ({ open: (): void => undefined }));
const originalInnerWidth = window.innerWidth;

vi.mock('../../../useCases/dialogs/openPreferencesSection', () => ({
    openPreferencesSection: () => preferencesOpener.open(),
}));
vi.mock('#/modules/WorkspaceShell/presentations/hooks/useUndoState', () => ({
    useUndoState: () => ({ canUndo: false, canRedo: false, lastAction: null, undoCount: 0 }),
}));
vi.mock('#/modules/WorkspaceShell/presentations/hooks/useCollaborationState', () => ({
    useCollaborationState: () => ({ connectionStatus: 'disconnected', isEnabled: false, peers: [] }),
}));
vi.mock('#/modules/WorkspaceShell/presentations/hooks/useSelectionLabel', () => ({
    useSelectionLabel: () => '',
}));
vi.mock('#/modules/WorkspaceShell/presentations/hooks/useStatusBarMetrics', () => ({
    useStatusBarMetrics: () => {},
}));

const setViewportWidth = (width: number): void => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
};

const Shell = (): ReactElement => {
    const [open, setOpen] = useState(false);
    useEffect(() => {
        preferencesOpener.open = () => setOpen(true);
    }, []);
    return (
        <TooltipProvider delayDuration={0}>
            <StatusBar />
            <main data-focus-landmark="" tabIndex={-1}>
                Workspace
            </main>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent aria-describedby={undefined}>
                    <DialogTitle>Preferences</DialogTitle>
                </DialogContent>
            </Dialog>
        </TooltipProvider>
    );
};

const findBadge = (): HTMLElement => screen.getByRole('button', { name: /MIDI/ });

describe('MIDI status badge opening Preferences', () => {
    beforeEach(() => {
        setViewportWidth(1440);
    });

    afterAll(() => {
        setViewportWidth(originalInnerWidth);
    });

    it('returns focus to the badge when Escape closes Preferences', async () => {
        render(<Shell />);
        const badge = findBadge();
        badge.focus();
        fireEvent.click(badge);
        await screen.findByRole('dialog', { name: 'Preferences' });

        fireEvent.keyDown(screen.getByRole('dialog', { name: 'Preferences' }), { key: 'Escape' });

        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Preferences' })).not.toBeInTheDocument());
        await waitFor(() => expect(findBadge()).toHaveFocus());
    });

    it('returns focus to the More control in the compact footer, where the badge lives in a popover that closes', async () => {
        setViewportWidth(800);
        render(<Shell />);
        fireEvent.click(screen.getByRole('button', { name: 'More application status' }));
        const badge = findBadge();
        badge.focus();
        fireEvent.click(badge);
        await screen.findByRole('dialog', { name: 'Preferences' });

        fireEvent.keyDown(screen.getByRole('dialog', { name: 'Preferences' }), { key: 'Escape' });

        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Preferences' })).not.toBeInTheDocument());
        await waitFor(() => expect(screen.getByRole('button', { name: 'More application status' })).toHaveFocus());
    });
});
