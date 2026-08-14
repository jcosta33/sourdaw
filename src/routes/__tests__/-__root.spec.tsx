import { type ReactNode } from 'react';

import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { RootLayout, RootError } from '../__root';

// Mock TanStack Router
vi.mock('@tanstack/react-router', () => ({
    Outlet: () => <div data-testid="outlet">Outlet</div>,
    createRootRouteWithContext: () => () => ({}),
}));

// Mock AppShell
vi.mock('#/modules/WorkspaceShell/presentations/views', () => ({
    AppShell: ({ children }: { children: ReactNode }) => <div data-testid="app-shell">{children}</div>,
    WorkspaceMobileGate: ({ children }: { children: ReactNode }) => <div data-testid="mobile-gate">{children}</div>,
}));

describe('RootLayout', () => {
    it('should render AppShell with an Outlet', () => {
        render(<RootLayout />);
        expect(screen.getByTestId('app-shell')).toBeInTheDocument();
        expect(screen.getByTestId('outlet')).toBeInTheDocument();
    });

    it('should mount AppShell inside the mobile gate, not beside it', () => {
        render(<RootLayout />);

        // The gate has to own the shell's mount: hooks cannot be conditional, so a
        // viewport check inside AppShell still runs engine init, project load, MIDI
        // start and autosave behind the "Desktop DAW" notice. Only being a descendant
        // of the gate stops that.
        expect(screen.getByTestId('app-shell').closest('[data-testid="mobile-gate"]')).not.toBeNull();
    });
});

describe('RootError', () => {
    it('should render error message', () => {
        render(<RootError />);
        expect(screen.getByText('Something went wrong')).toBeInTheDocument();
        expect(screen.getByText(/An unexpected error occurred/)).toBeInTheDocument();
    });
});
