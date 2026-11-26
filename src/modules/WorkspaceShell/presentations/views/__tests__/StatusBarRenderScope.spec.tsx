import { useSyncExternalStore } from 'react';

import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';

import { StatusBar } from '../StatusBar';

type UndoView = { canUndo: boolean; canRedo: boolean; lastAction: { label: string } | null; undoCount: number };

const live = vi.hoisted(() => {
    const listeners = new Set<() => void>();
    const undo: UndoView = { canUndo: false, canRedo: false, lastAction: null, undoCount: 0 };
    return { listeners, undo, selection: '', footerRenders: 0 };
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
    useCollaborationState: () => ({ connectionStatus: 'disconnected', isEnabled: false, peers: [] }),
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
});
