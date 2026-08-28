import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LlmStatusBadge } from '../LlmStatusBadge';

vi.mock('#/modules/AiRuntime/useCases/llmOrchestration/backendResolution/isLlmAvailable', () => ({
    isLlmAvailable: vi.fn(() => false),
}));

const { capabilityStore, isWebGpuAvailable } = await import('#/modules/BrowserAi/stores');
const { isLlmAvailable } =
    await import('#/modules/AiRuntime/useCases/llmOrchestration/backendResolution/isLlmAvailable');

const verifiedWebGpuReport = {
    capability: 'supported' as const,
    webGpu: { status: 'supported' as const },
    webGpuTier: 'not-measured' as const,
    crossOriginIsolated: true,
    workerAvailable: true,
    opfsAvailable: true,
    inference: { status: 'not-measured' as const, reason: 'not-requested' as const },
    detectedAt: 0,
};

const noAdapterReport = {
    ...verifiedWebGpuReport,
    capability: 'unsupported-browser' as const,
    webGpu: { status: 'unavailable' as const, reason: 'adapter-unavailable' as const },
    inference: { status: 'not-measured' as const, reason: 'no-webgpu' as const },
};

function renderBadge(): void {
    render(<LlmStatusBadge status={{ state: 'idle' }} onLoad={vi.fn()} />);
}

describe('LlmStatusBadge', () => {
    beforeEach(() => {
        capabilityStore.set({ phase: 'idle' });
        // The badge's availability question is "does BrowserAi admit a WebGPU
        // device", so the mock answers it from the same store the product reads.
        (isLlmAvailable as ReturnType<typeof vi.fn>).mockImplementation(isWebGpuAvailable);
    });

    it('reports that availability is still being checked while detection is pending', () => {
        capabilityStore.set({ phase: 'detecting' });

        renderBadge();

        expect(screen.getByText('Checking AI availability')).toBeInTheDocument();
        expect(screen.queryByText('AI unavailable')).not.toBeInTheDocument();
    });

    it('reports AI unavailable once detection settles without a usable adapter', () => {
        capabilityStore.set({ phase: 'done', report: noAdapterReport });

        renderBadge();

        expect(screen.getByText('AI unavailable')).toHaveAttribute('title', 'No configured AI backend is available');
        expect(screen.queryByRole('button', { name: 'Load AI' })).not.toBeInTheDocument();
    });

    it('replaces the checking state with the load affordance when detection admits a device', () => {
        capabilityStore.set({ phase: 'detecting' });
        renderBadge();
        expect(screen.getByText('Checking AI availability')).toBeInTheDocument();

        act(() => {
            capabilityStore.set({ phase: 'done', report: verifiedWebGpuReport });
        });

        expect(screen.queryByText('Checking AI availability')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Load AI' })).toBeInTheDocument();
    });

    it('names the selected model on the download button and states what downloading does', () => {
        capabilityStore.set({ phase: 'done', report: verifiedWebGpuReport });
        renderBadge();

        fireEvent.click(screen.getByRole('button', { name: 'Load AI' }));

        const downloadButton = screen.getByRole('button', { name: /^Download & Load/ });
        expect(downloadButton).toHaveTextContent('Download & Load Standard');

        fireEvent.click(screen.getByRole('button', { name: /^Pro/ }));
        expect(downloadButton).toHaveTextContent('Download & Load Pro');

        fireEvent.click(screen.getByRole('button', { name: /^Light/ }));
        expect(downloadButton).toHaveTextContent('Download & Load Light');

        expect(
            screen.getByText('Downloads and verifies this model for private use in this browser.')
        ).toBeInTheDocument();
    });
});
