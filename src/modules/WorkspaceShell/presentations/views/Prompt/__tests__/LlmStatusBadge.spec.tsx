import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { aiBackendPreferenceStore, hostedLlmProviderStatusStore, machineMemoryStore } from '#/modules/AiRuntime/stores';
import { configureCloudProvider, removeCloudProvider } from '#/modules/AiRuntime/useCases';
import { capabilityStore } from '#/modules/BrowserAi/stores';

import { LlmStatusBadge } from '../LlmStatusBadge';

import type { listOfferedLocalModels } from '#/modules/AiRuntime/useCases';

type MachineMemoryReading = Parameters<typeof listOfferedLocalModels>[0];

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
        // Settled, so the badge's mount-time read is a no-op for cases that are not about the reading.
        machineMemoryStore.set({ state: 'unavailable' });
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

    describe('the local models this machine can run', () => {
        const light = /^Light/;
        const standard = /^Standard/;
        const pro = /^Pro/;

        async function openPicker(reading: MachineMemoryReading, onLoad = vi.fn()): Promise<void> {
            capabilityStore.set({ phase: 'done', report: verifiedWebGpuReport });
            machineMemoryStore.set(reading);
            await act(async () => {
                render(<LlmStatusBadge status={{ state: 'idle' }} onLoad={onLoad} />);
            });
            if (reading.state === 'unread') {
                // The mount-time read must really run and settle, not be assumed.
                await waitFor(() => expect(machineMemoryStore.value).toEqual({ state: 'unavailable' }));
            }
            fireEvent.click(screen.getByRole('button', { name: 'Load AI' }));
        }

        it.each([
            {
                label: '8 GB clears Light and Standard only',
                bytes: 8_000_000_000,
                listed: [light, standard],
                hidden: [pro],
            },
            {
                label: '16 GB clears Light, Standard and Pro',
                bytes: 16_000_000_000,
                listed: [light, standard, pro],
                hidden: [],
            },
            {
                label: 'exactly the Pro figure clears Pro',
                bytes: 10_300_000_000,
                listed: [light, standard, pro],
                hidden: [],
            },
            {
                label: 'one byte under the Pro figure does not',
                bytes: 10_299_999_999,
                listed: [light, standard],
                hidden: [pro],
            },
            {
                label: 'exactly the Standard figure clears Standard',
                bytes: 4_300_000_000,
                listed: [light, standard],
                hidden: [pro],
            },
            {
                label: 'one byte under the Standard figure does not',
                bytes: 4_299_999_999,
                listed: [light],
                hidden: [standard, pro],
            },
        ])('lists only what the reported memory clears: $label', async ({ bytes, listed, hidden }) => {
            await openPicker({ state: 'known', totalBytes: bytes });

            for (const name of listed) {
                expect(screen.getByRole('button', { name })).toBeInTheDocument();
            }
            for (const name of hidden) {
                expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
            }
        });

        it.each([
            { label: 'unavailable', reading: { state: 'unavailable' } as const },
            { label: 'unread', reading: { state: 'unread' } as const },
        ])('lists every shipped tier with its memory figure when the reading is $label', async ({ reading }) => {
            await openPicker(reading);

            expect(screen.getByRole('button', { name: light })).toHaveTextContent('~2.7 GB');
            expect(screen.getByRole('button', { name: standard })).toHaveTextContent('~4.3 GB');
            expect(screen.getByRole('button', { name: pro })).toHaveTextContent('~10.3 GB');
        });

        it('selects the largest offered model, not the unoffered default, and loads that one', async () => {
            const onLoad = vi.fn();
            await openPicker({ state: 'known', totalBytes: 8_000_000_000 }, onLoad);

            const downloadButton = screen.getByRole('button', { name: /^Download & Load/ });
            expect(downloadButton).toHaveTextContent('Download & Load Standard');

            fireEvent.click(downloadButton);
            expect(onLoad).toHaveBeenCalledWith('Qwen3-4B-q4f16_1-MLC');
        });

        it('states the machine memory and offers no download when no local model fits', async () => {
            await openPicker({ state: 'known', totalBytes: 1_000_000_000 });

            expect(screen.getByText(/1\.0 GB of memory, and no local model fits/)).toBeInTheDocument();
            expect(screen.queryByRole('button', { name: /^Download & Load/ })).not.toBeInTheDocument();
            expect(screen.queryByRole('button', { name: light })).not.toBeInTheDocument();
        });
    });

    describe('loads started from the badge go through the offered selection', () => {
        const errorStatus = { state: 'error' as const, message: 'The model download failed.' };

        beforeEach(() => {
            capabilityStore.set({ phase: 'done', report: verifiedWebGpuReport });
            aiBackendPreferenceStore.set('auto');
            hostedLlmProviderStatusStore.set(null);
        });

        // The engine's active model id is the Pro default: the model the retry used to fall back to.
        it('retries with the largest offered model, not the unoffered active default, on an 8 GB machine', () => {
            machineMemoryStore.set({ state: 'known', totalBytes: 8_000_000_000 });
            const onLoad = vi.fn();
            render(<LlmStatusBadge status={errorStatus} onLoad={onLoad} />);

            fireEvent.click(screen.getByRole('button', { name: 'Retry Model Download' }));

            expect(onLoad).toHaveBeenCalledWith('Qwen3-4B-q4f16_1-MLC');
        });

        it('offers no local retry when no local model fits', () => {
            machineMemoryStore.set({ state: 'known', totalBytes: 1_000_000_000 });
            render(<LlmStatusBadge status={errorStatus} onLoad={vi.fn()} />);

            expect(screen.queryByRole('button', { name: 'Retry Model Download' })).not.toBeInTheDocument();
            expect(screen.getByText('No local model fits')).toHaveAttribute(
                'title',
                expect.stringContaining('no local model fits')
            );
        });

        it('keeps the hosted retry as it was', async () => {
            await act(async () => {
                await configureCloudProvider({
                    provider: 'openai-compatible',
                    model: 'local-hosted-model',
                    baseUrl: 'http://localhost:1234/v1',
                    authentication: 'none',
                    apiKey: '',
                });
            });
            aiBackendPreferenceStore.set('cloud');
            machineMemoryStore.set({ state: 'known', totalBytes: 8_000_000_000 });
            const onLoad = vi.fn();
            try {
                render(<LlmStatusBadge status={errorStatus} onLoad={onLoad} />);

                fireEvent.click(screen.getByRole('button', { name: 'AI Error — retry' }));

                expect(onLoad).toHaveBeenCalledWith();
            } finally {
                await act(async () => {
                    await removeCloudProvider();
                });
            }
        });

        it('describes the model that is loaded, not the one the picker would select', () => {
            machineMemoryStore.set({ state: 'known', totalBytes: 16_000_000_000 });
            render(
                <LlmStatusBadge
                    status={{ state: 'ready', backend: 'webllm', modelId: 'Qwen3-1.7B-q4f16_1-MLC' }}
                    onLoad={vi.fn()}
                />
            );

            fireEvent.click(screen.getByRole('button', { name: 'AI Ready' }));

            expect(screen.getByText('Light')).toBeInTheDocument();
            expect(screen.getByText('Active · ~2.7 GB RAM')).toBeInTheDocument();
            expect(screen.queryByText('Pro')).not.toBeInTheDocument();
        });
    });

    describe('when this machine cannot run the requested model', () => {
        const storageRefusal = {
            state: 'error' as const,
            message:
                'The Pro model needs 4.63 GB to download, but this browser has 1.20 GB of storage left. Free some space or pick a smaller model. Nothing was downloaded.',
            refusal: {
                reason: 'insufficient-storage' as const,
                modelId: 'Qwen3-8B-q4f16_1-MLC',
                requiredBytes: 4_630_000_000,
                availableBytes: 1_200_000_000,
            },
        };

        function renderRefused(status: Parameters<typeof LlmStatusBadge>[0]['status'], onLoad = vi.fn()): void {
            capabilityStore.set({ phase: 'done', report: verifiedWebGpuReport });
            render(<LlmStatusBadge status={status} onLoad={onLoad} />);
        }

        it.each([
            { label: 'storage', status: storageRefusal, trigger: 'Not enough storage', sentence: /4\.63 GB.*1\.20 GB/ },
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

            // The picker's selection, not the engine's silent fallback, is what a retry loads.
            expect(onLoad).toHaveBeenCalledWith('Qwen3-8B-q4f16_1-MLC');
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        });
    });

    describe('while a turn is answering', () => {
        const PRO_MODEL_ID = 'Qwen3-8B-q4f16_1-MLC';
        const localAnswering = { state: 'generating' as const, backend: 'webllm' as const, modelId: PRO_MODEL_ID };
        const hostedAnswering = {
            state: 'generating' as const,
            backend: 'cloud' as const,
            provider: 'anthropic' as const,
            modelId: 'claude-hosted-model',
        };

        beforeEach(() => {
            capabilityStore.set({ phase: 'done', report: verifiedWebGpuReport });
            aiBackendPreferenceStore.set('auto');
            hostedLlmProviderStatusStore.set(null);
        });

        it('names the local model answering the turn', () => {
            render(<LlmStatusBadge status={localAnswering} onLoad={vi.fn()} />);

            expect(screen.getByRole('status')).toHaveTextContent('Answering with Browser · Pro');
        });

        it('names the hosted provider and model as the ready panel names them', () => {
            render(<LlmStatusBadge status={hostedAnswering} onLoad={vi.fn()} />);

            expect(screen.getByRole('status')).toHaveTextContent('Answering with Anthropic · claude-hosted-model');
        });

        it('follows a fall-through from the hosted provider to the local model', () => {
            const view = render(<LlmStatusBadge status={hostedAnswering} onLoad={vi.fn()} />);
            expect(screen.getByRole('status')).toHaveTextContent('Anthropic · claude-hosted-model');

            view.rerender(<LlmStatusBadge status={localAnswering} onLoad={vi.fn()} />);

            expect(screen.getByRole('status')).toHaveTextContent('Answering with Browser · Pro');
            expect(screen.queryByText(/Anthropic/)).not.toBeInTheDocument();
        });

        // Red when the badge names the preference or the configured hosted provider instead of the
        // backend of the generating status. Which backend answers under automatic routing is
        // `inference.spec.ts`'s; this case only feeds the badge a local attempt beside those distractors.
        it('names the backend of the generating status, never the preference or the configured hosted provider', () => {
            aiBackendPreferenceStore.set('auto');
            hostedLlmProviderStatusStore.set({
                provider: 'anthropic',
                model: 'claude-hosted-model',
                baseUrl: null,
                authentication: 'api-key',
                reasoningEffort: null,
                thinking: null,
            });

            render(<LlmStatusBadge status={localAnswering} onLoad={vi.fn()} />);

            expect(screen.getByRole('status')).toHaveTextContent('Answering with Browser · Pro');
            expect(screen.queryByText(/Anthropic|claude-hosted-model/)).not.toBeInTheDocument();
        });

        it('says nothing about answering while idle', () => {
            render(<LlmStatusBadge status={{ state: 'idle' }} onLoad={vi.fn()} />);

            expect(screen.getByRole('button', { name: 'Load AI' })).toBeInTheDocument();
            expect(screen.queryByText(/Answering/)).not.toBeInTheDocument();
            expect(screen.queryByRole('status')).not.toBeInTheDocument();
        });
    });
});
