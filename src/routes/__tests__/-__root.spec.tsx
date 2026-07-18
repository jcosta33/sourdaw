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
}));

describe('RootLayout', () => {
    it('should render AppShell with an Outlet', () => {
        render(<RootLayout />);
        expect(screen.getByTestId('app-shell')).toBeInTheDocument();
        expect(screen.getByTestId('outlet')).toBeInTheDocument();
    });
});

describe('RootError', () => {
    it('should render error message', () => {
        render(<RootError />);
        expect(screen.getByText('Something went wrong')).toBeInTheDocument();
        expect(screen.getByText(/An unexpected error occurred/)).toBeInTheDocument();
    });
});
