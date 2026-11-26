import { useSyncExternalStore } from 'react';

import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';

import { StatusBar } from '../StatusBar';

type UndoView = { canUndo: boolean; canRedo: boolean; lastAction: { label: string } | null; undoCount: number };

type CollabView = { connectionStatus: 'disconnected' | 'connected'; isEnabled: boolean; peers: { id: string }[] };

const live = vi.hoisted(() => {
    const listeners = new Set<() => void>();
    const undo: UndoView = { canUndo: false, canRedo: false, lastAction: null, undoCount: 0 };
    const collab: CollabView = { connectionStatus: 'disconnected', isEnabled: false, peers: [] };
    return { listeners, undo, collab, selection: '', footerRenders: 0 };
});

const subscribe = (listener: () => void): (() => void) => {
    live.listeners.add(listener);
    return () => live.listeners.delete(listener);
};
const publish = (): void => {
    for (const listener of live.listeners) {
        listener();
    }
};

vi.mock('#/modules/WorkspaceShell/presentations/hooks/useUndoState', () => ({
    useUndoState: (): UndoView => useSyncExternalStore(subscribe, () => live.undo),
}));
vi.mock('#/modules/WorkspaceShell/presentations/hooks/useSelectionLabel', () => ({
    useSelectionLabel: (): string => useSyncExternalStore(subscribe, () => live.selection),
}));
vi.mock('#/modules/WorkspaceShell/presentations/hooks/useCollaborationState', () => ({
    useCollaborationState: (): CollabView => useSyncExternalStore(subscribe, () => live.collab),
}));
// StatusBar calls this hook once per render of its own body.
vi.mock('#/modules/WorkspaceShell/presentations/hooks/useStatusBarMetrics', () => ({
    useStatusBarMetrics: () => {
        live.footerRenders++;
    },
}));

describe('StatusBar render scope', () => {
    it('a new undo step and selection update their readouts without rendering the footer body again', () => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1440 });
        render(
            <TooltipProvider delayDuration={0}>
                <StatusBar />
            </TooltipProvider>
        );
        const rendersAfterMount = live.footerRenders;
        expect(rendersAfterMount).toBeGreaterThan(0);
        expect(screen.getByText('0 undos')).toBeTruthy();

        act(() => {
            live.undo = { canUndo: true, canRedo: false, lastAction: { label: 'Detect transients' }, undoCount: 1 };
            live.selection = '1 clip';
            publish();
        });

        expect(screen.getByText('1 undo')).toBeTruthy();
        expect(screen.getByText('Last: Detect transients')).toBeTruthy();
        expect(screen.getByRole('status', { name: '1 clip' }).textContent).toBe('1 clip');
        expect(live.footerRenders).toBe(rendersAfterMount);
    });

    it('a collaboration change after mount updates the peer count and status dot without rendering the footer body again', () => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1440 });
        render(
            <TooltipProvider delayDuration={0}>
                <StatusBar />
            </TooltipProvider>
        );
        const rendersAfterMount = live.footerRenders;
        const button = screen.getByTestId('toggle-collaboration');
        const dot = (): Element | null => button.querySelector('span');
        expect(button.textContent).toBe('0');
        expect(dot()?.className).toContain('bg-muted-foreground/50');

        act(() => {
            live.collab = { connectionStatus: 'connected', isEnabled: true, peers: [{ id: 'a' }, { id: 'b' }] };
            publish();
        });

        expect(button.textContent).toBe('2');
        expect(dot()?.className).toContain('bg-[var(--color-state-success)]');
        expect(live.footerRenders).toBe(rendersAfterMount);
    });
});
