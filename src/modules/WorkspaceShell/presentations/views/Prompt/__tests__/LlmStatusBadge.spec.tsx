import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { capabilityStore } from '#/modules/BrowserAi/stores';

import { LlmStatusBadge } from '../LlmStatusBadge';

// Nothing here is stubbed: the badge resolves its backend through the real
// admission chain, so the capability report is the only input that decides what
// it renders.
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

        // The panel must describe the backend the badge just admitted: an
        // offer to load AI over a panel that still knows no backend is the
        // stale half of a two-answer availability read.
        fireEvent.click(screen.getByRole('button', { name: 'Load AI' }));
        expect(screen.getByRole('button', { name: /^Pro/ })).toBeInTheDocument();
    });

    it('names the selected model on the download button and states what downloading does', () => {
        capabilityStore.set({ phase: 'done', report: verifiedWebGpuReport });
        renderBadge();

        fireEvent.click(screen.getByRole('button', { name: 'Load AI' }));

        const downloadButton = screen.getByRole('button', { name: /^Download & Load/ });
        expect(downloadButton).toHaveTextContent('Download & Load Pro');

        fireEvent.click(screen.getByRole('button', { name: /^Standard/ }));
        expect(downloadButton).toHaveTextContent('Download & Load Standard');

        fireEvent.click(screen.getByRole('button', { name: /^Light/ }));
        expect(downloadButton).toHaveTextContent('Download & Load Light');

        expect(
            screen.getByText('Downloads and verifies this model for private use in this browser.')
        ).toBeInTheDocument();
    });

    it('calls onLoad and closes the popover when the download button is clicked in idle state', () => {
        const onLoad = vi.fn();
        capabilityStore.set({ phase: 'done', report: verifiedWebGpuReport });
        render(<LlmStatusBadge status={{ state: 'idle' }} onLoad={onLoad} />);

        fireEvent.click(screen.getByRole('button', { name: 'Load AI' }));
        const downloadButton = screen.getByRole('button', { name: /^Download & Load/ });
        expect(downloadButton).toBeInTheDocument();

        fireEvent.click(downloadButton);
        expect(onLoad).toHaveBeenCalled();
        expect(screen.queryByRole('button', { name: /^Download & Load/ })).not.toBeInTheDocument();
    });

    it('opens the ready-state popover with model details and unload option', () => {
        render(
            <LlmStatusBadge
                status={{ state: 'ready', backend: 'webllm', modelId: 'webllm-llama-3-8b' }}
                onLoad={vi.fn()}
            />
        );

        const readyButton = screen.getByRole('button', { name: 'AI Ready' });
        expect(readyButton).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Unload from Memory' })).not.toBeInTheDocument();

        fireEvent.click(readyButton);
        expect(screen.getByRole('button', { name: 'Unload from Memory' })).toBeInTheDocument();
    });

    describe('when this machine cannot run the requested model', () => {
        const storageRefusal = {
            state: 'error' as const,
            message:
                'The Pro model needs 5.3 GB to download, but this browser has 1.2 GB of storage left. Free some space or pick a smaller model. Nothing was downloaded.',
            refusal: {
                reason: 'insufficient-storage' as const,
                modelId: 'Qwen3-8B-q4f16_1-MLC',
                requiredBytes: 5_300_000_000,
                availableBytes: 1_200_000_000,
            },
        };

        function renderRefused(status: Parameters<typeof LlmStatusBadge>[0]['status'], onLoad = vi.fn()): void {
            capabilityStore.set({ phase: 'done', report: verifiedWebGpuReport });
            render(<LlmStatusBadge status={status} onLoad={onLoad} />);
        }

        it.each([
            { label: 'storage', status: storageRefusal, trigger: 'Not enough storage', sentence: /5\.3 GB.*1\.2 GB/ },
            {
                label: 'shader-f16',
                status: {
                    state: 'error' as const,
                    message:
                        'The Pro model cannot run here: this GPU or browser lacks the WebGPU shader-f16 feature it needs. Nothing was downloaded.',
                    refusal: { reason: 'shader-f16-unavailable' as const, modelId: 'Qwen3-8B-q4f16_1-MLC' },
                },
                trigger: 'Needs shader-f16',
                sentence: /lacks the WebGPU shader-f16 feature/,
            },
            {
                label: 'gpu memory',
                status: {
                    state: 'error' as const,
                    message:
                        'The Pro model did not fit in GPU memory: it needs ~10.3 GB of GPU memory. The download is kept; pick a smaller model or free GPU memory and try again.',
                    refusal: { reason: 'gpu-memory' as const, modelId: 'Qwen3-8B-q4f16_1-MLC' },
                },
                trigger: 'Not enough GPU memory',
                sentence: /needs ~10\.3 GB of GPU memory/,
            },
        ])('labels a $label refusal and explains it in full once opened', ({ status, trigger, sentence }) => {
            renderRefused(status);

            expect(screen.queryByRole('button', { name: 'Retry Model Download' })).not.toBeInTheDocument();
            fireEvent.click(screen.getByRole('button', { name: trigger }));

            expect(screen.getByRole('alert')).toHaveTextContent(sentence);
        });

        it('offers the model chooser and Download & Load beside the refusal, loading the chosen model', () => {
            const onLoad = vi.fn();
            renderRefused(storageRefusal, onLoad);

            fireEvent.click(screen.getByRole('button', { name: 'Not enough storage' }));
            fireEvent.click(screen.getByRole('button', { name: /^Light/ }));
            fireEvent.click(screen.getByRole('button', { name: /^Download & Load Light/ }));

            expect(onLoad).toHaveBeenCalledWith('Qwen3-1.7B-q4f16_1-MLC');
        });

        it('keeps a plain error as the retry button', () => {
            const onLoad = vi.fn();
            renderRefused({ state: 'error', message: 'network went away' }, onLoad);

            fireEvent.click(screen.getByRole('button', { name: 'Retry Model Download' }));

            expect(onLoad).toHaveBeenCalledWith();
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        });
    });
});
