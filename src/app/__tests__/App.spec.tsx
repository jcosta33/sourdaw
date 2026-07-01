import { type ReactNode } from 'react';

import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { App } from '../App';

// Mock providers and components
vi.mock('@tanstack/react-query', () => ({
    QueryClientProvider: ({ children }: { children: React.ReactNode }) => (
        <div data-testid="query-provider">{children}</div>
    ),
}));

vi.mock('@tanstack/react-router', () => ({
    RouterProvider: () => <div data-testid="router-provider">Router Provider</div>,
}));

vi.mock('#/components/ui/tooltip', () => ({
    TooltipProvider: ({ children }: { children: React.ReactNode }) => (
        <div data-testid="tooltip-provider">{children}</div>
    ),
}));

vi.mock('#/modules/Workspace/presentations/views', () => ({
    WorkspaceAppBoundary: ({ children }: { children: ReactNode }) => <div data-testid="error-boundary">{children}</div>,
    WorkspaceProjectLoadingFallback: () => <div data-testid="project-loading-fallback" />,
}));

vi.mock('../queryClient', () => ({
    queryClient: {},
}));

vi.mock('../router', () => ({
    router: {},
}));

describe('App', () => {
    it('should render all providers and router', () => {
        render(<App />);
        expect(screen.getByTestId('error-boundary')).toBeInTheDocument();
        expect(screen.getByTestId('query-provider')).toBeInTheDocument();
        expect(screen.getByTestId('tooltip-provider')).toBeInTheDocument();
        expect(screen.getByTestId('router-provider')).toBeInTheDocument();
    });
});
