import { type ReactNode } from 'react';

import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { App } from '../App';
import { registerDeviceEnginePorts } from '../registerDeviceEnginePorts';
import { registerKernelPorts } from '../registerKernelPorts';
import { registerSupportingServicePorts } from '../registerSupportingServicePorts';

vi.mock('../registerDeviceEnginePorts', () => ({
    registerDeviceEnginePorts: vi.fn<() => void>(),
}));

vi.mock('../registerSupportingServicePorts', () => ({
    registerSupportingServicePorts: vi.fn<() => void>(),
}));

vi.mock('../registerKernelPorts', () => ({
    registerKernelPorts: vi.fn<() => void>(),
}));

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

vi.mock('#/modules/WorkspaceShell/presentations/views', () => ({
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
    it('registers the device engine ports when the module loads, before any render', () => {
        // `main.tsx` may render App before bootstrap has run, and the preset
        // browser reads the preset port while it renders.
        expect(registerDeviceEnginePorts).toHaveBeenCalledExactlyOnceWith();
    });

    it('registers the supporting service ports when the module loads, before any render', () => {
        expect(registerSupportingServicePorts).toHaveBeenCalledExactlyOnceWith();
    });

    it('registers the kernel ports when the module loads, before any render', () => {
        expect(registerKernelPorts).toHaveBeenCalledExactlyOnceWith();
    });

    it('should render all providers and router', () => {
        render(<App />);
        expect(screen.getByTestId('error-boundary')).toBeInTheDocument();
        expect(screen.getByTestId('query-provider')).toBeInTheDocument();
        expect(screen.getByTestId('tooltip-provider')).toBeInTheDocument();
        expect(screen.getByTestId('router-provider')).toBeInTheDocument();
    });
});
