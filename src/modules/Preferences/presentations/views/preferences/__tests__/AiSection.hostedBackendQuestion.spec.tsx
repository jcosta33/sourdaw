import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultPreferences } from '../../../../models/Preferences';
import { preferencesStore } from '../../../../stores/preferencesStore';
import { AiSection } from '../AiSection';

import type { hostedLlmProviderStatusStore } from '#/modules/AiRuntime/stores';

type HostedProviderStatus = typeof hostedLlmProviderStatusStore.value;

// The mocks mirror AiSection.spec.tsx, except that the backend preference store reads the same
// live value as `useStore`, so a case can move the selector while a save is pending.
const mocks = vi.hoisted(() => ({
    admission: { webLlm: true },
    backendPreference: { value: 'auto' },
    catalogModelA: { value: 'catalog-model-a', label: 'Catalog Model A — Recommended' },
    catalogModelB: { value: 'catalog-model-b', label: 'Catalog Model B' },
    configureCloudProvider: vi.fn(),
    hostedProvider: {
        value: null as HostedProviderStatus,
    },
    isDesktop: true,
    llmStatus: { value: { state: 'idle' } },
    removeCloudProvider: vi.fn(),
    resolveBackend: vi.fn(() => 'none'),
    setAiBackendPreference: vi.fn(),
}));

vi.mock('#/infra/release/modelReleaseAdmission', () => ({
    MODEL_RELEASE_ADMISSION: mocks.admission,
}));

vi.mock('#/infra/store/useStore', () => ({
    useStore: (_store: unknown, fallback: unknown) => {
        if (fallback === 'auto') {
            return mocks.backendPreference.value;
        }
        if (fallback === null) {
            return mocks.hostedProvider.value;
        }
        return mocks.llmStatus.value;
    },
}));

vi.mock('#/modules/AiRuntime/stores', () => ({
    aiBackendPreferenceStore: {
        get value() {
            return mocks.backendPreference.value;
        },
    },
    hostedLlmProviderStatusStore: {},
    llmStatusStore: {},
}));

// This tuple literal mirrors HOSTED_REASONING_EFFORTS, and the thinking minimum mirrors
// HOSTED_ANTHROPIC_THINKING_MIN_BUDGET_TOKENS, both in
// src/modules/AiRuntime/models/HostedLlmProvider.ts; keep them equal.
vi.mock('#/modules/AiRuntime/useCases', () => ({
    configureCloudProvider: mocks.configureCloudProvider,
    getDefaultHostedAnthropicModel: () => mocks.catalogModelA.value,
    HOSTED_ANTHROPIC_THINKING_MIN_BUDGET_TOKENS: 1024,
    HOSTED_REASONING_EFFORTS: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
    listHostedAnthropicModels: () => [mocks.catalogModelA, mocks.catalogModelB],
    removeCloudProvider: mocks.removeCloudProvider,
    resolveBackend: mocks.resolveBackend,
    setAiBackendPreference: mocks.setAiBackendPreference,
}));

vi.mock('#/modules/BrowserAi/presentations/views', () => ({
    CapabilityReportPanel: () => <div data-testid="capability-report-panel" />,
    ModelManagerPanel: () => <div data-testid="model-manager-panel" />,
}));

vi.mock('#/utils/platformCapabilities', () => ({
    getPlatformCapabilities: () => ({ isDesktopApp: mocks.isDesktop }),
}));

describe('AiSection hosted backend question', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.admission.webLlm = true;
        mocks.backendPreference.value = 'auto';
        mocks.hostedProvider.value = null;
        mocks.isDesktop = true;
        mocks.llmStatus.value = { state: 'idle' };
        mocks.resolveBackend.mockReturnValue('none');
        preferencesStore.set(defaultPreferences);
    });

    describe('asking once to select a saved hosted provider', () => {
        const QUESTION = /^Automatic never sends requests to a hosted provider\. Use (.+) for AI requests\?$/u;

        async function connectWithKey(key: string): Promise<void> {
            const apiKey = screen.getByLabelText('Hosted AI API key');
            fireEvent.change(apiKey, { target: { value: key } });
            fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
            // A successful save clears the key draft; the question, when owed, is shown in the same update.
            await waitFor(() => {
                expect(apiKey).toHaveValue('');
            });
        }

        function question(): HTMLElement {
            return screen.getByRole('group', { name: QUESTION });
        }

        it('asks after a successful save under Automatic, naming the provider', async () => {
            render(<AiSection />);

            await connectWithKey('sk-first');

            expect(question()).toHaveAccessibleName(
                'Automatic never sends requests to a hosted provider. Use Anthropic for AI requests?'
            );
            expect(mocks.setAiBackendPreference).not.toHaveBeenCalled();
        });

        it('selects the hosted provider only on yes, once', async () => {
            render(<AiSection />);
            await connectWithKey('sk-first');

            fireEvent.click(within(question()).getByRole('button', { name: 'Use hosted provider' }));

            expect(mocks.setAiBackendPreference).toHaveBeenCalledExactlyOnceWith('cloud');
            expect(screen.queryByRole('group', { name: QUESTION })).not.toBeInTheDocument();
        });

        it('changes nothing on Keep Automatic, and does not ask again for the same provider', async () => {
            render(<AiSection />);
            await connectWithKey('sk-first');

            fireEvent.click(within(question()).getByRole('button', { name: 'Keep Automatic' }));
            expect(screen.queryByRole('group', { name: QUESTION })).not.toBeInTheDocument();

            // A new key and model for the same provider is the same identity.
            fireEvent.change(screen.getByLabelText('Hosted AI model'), {
                target: { value: mocks.catalogModelB.value },
            });
            await connectWithKey('sk-second');

            expect(mocks.configureCloudProvider).toHaveBeenCalledTimes(2);
            expect(screen.queryByRole('group', { name: QUESTION })).not.toBeInTheDocument();
            expect(mocks.setAiBackendPreference).not.toHaveBeenCalled();
        });

        it('counts a question left unanswered as no, even after Settings closes', async () => {
            const first = render(<AiSection />);
            await connectWithKey('sk-first');
            expect(question()).toBeInTheDocument();
            first.unmount();

            render(<AiSection />);
            await connectWithKey('sk-second');

            expect(mocks.configureCloudProvider).toHaveBeenCalledTimes(2);
            expect(screen.queryByRole('group', { name: QUESTION })).not.toBeInTheDocument();
        });

        it('asks again after yes, since the selection resets to Automatic next session', async () => {
            const first = render(<AiSection />);
            await connectWithKey('sk-first');
            fireEvent.click(within(question()).getByRole('button', { name: 'Use hosted provider' }));
            first.unmount();

            render(<AiSection />);
            await connectWithKey('sk-second');

            expect(question()).toBeInTheDocument();
        });

        it('asks once more for a different provider', async () => {
            render(<AiSection />);
            await connectWithKey('sk-first');
            fireEvent.click(within(question()).getByRole('button', { name: 'Keep Automatic' }));

            fireEvent.change(screen.getByLabelText('Hosted AI provider'), { target: { value: 'openai' } });
            await connectWithKey('sk-openai');

            expect(question()).toHaveAccessibleName(
                'Automatic never sends requests to a hosted provider. Use OpenAI for AI requests?'
            );
        });

        it('tells two OpenAI-compatible endpoints apart by their base URL', async () => {
            render(<AiSection />);
            fireEvent.change(screen.getByLabelText('Hosted AI provider'), { target: { value: 'openai-compatible' } });
            fireEvent.change(screen.getByLabelText('Hosted AI model'), { target: { value: 'endpoint-model' } });
            fireEvent.change(screen.getByLabelText('OpenAI-compatible base URL'), {
                target: { value: 'https://one.example/v1/' },
            });
            await connectWithKey('sk-one');
            fireEvent.click(within(question()).getByRole('button', { name: 'Keep Automatic' }));

            // The same endpoint written without its trailing slash is the endpoint already asked about.
            fireEvent.change(screen.getByLabelText('OpenAI-compatible base URL'), {
                target: { value: 'https://one.example/v1' },
            });
            await connectWithKey('sk-one-again');
            expect(screen.queryByRole('group', { name: QUESTION })).not.toBeInTheDocument();

            fireEvent.change(screen.getByLabelText('OpenAI-compatible base URL'), {
                target: { value: 'https://two.example/v1' },
            });
            await connectWithKey('sk-two');
            expect(question()).toBeInTheDocument();
        });

        it('never asks when the hosted provider is already selected', async () => {
            mocks.backendPreference.value = 'cloud';
            render(<AiSection />);

            await connectWithKey('sk-first');

            expect(mocks.configureCloudProvider).toHaveBeenCalledOnce();
            expect(screen.queryByRole('group', { name: QUESTION })).not.toBeInTheDocument();
            expect(preferencesStore.value?.hostedBackendQuestionAsked).toEqual([]);
        });

        it('reads the selector as it is when a pending save completes', async () => {
            let completeSave: () => void = () => undefined;
            mocks.configureCloudProvider.mockImplementationOnce(
                () =>
                    new Promise<void>((resolve) => {
                        completeSave = resolve;
                    })
            );
            mocks.backendPreference.value = 'cloud';
            render(<AiSection />);
            fireEvent.change(screen.getByLabelText('Hosted AI API key'), { target: { value: 'sk-first' } });
            fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
            mocks.backendPreference.value = 'auto';

            completeSave();

            expect(await screen.findByRole('group', { name: QUESTION })).toBeInTheDocument();
            expect(preferencesStore.value?.hostedBackendQuestionAsked).toEqual(['anthropic']);
        });

        it('records nothing when the selector leaves Automatic while the save is pending', async () => {
            let completeSave: () => void = () => undefined;
            mocks.configureCloudProvider.mockImplementationOnce(
                () =>
                    new Promise<void>((resolve) => {
                        completeSave = resolve;
                    })
            );
            render(<AiSection />);
            const apiKey = screen.getByLabelText('Hosted AI API key');
            fireEvent.change(apiKey, { target: { value: 'sk-first' } });
            fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
            mocks.backendPreference.value = 'cloud';

            completeSave();

            await waitFor(() => {
                expect(apiKey).toHaveValue('');
            });
            expect(screen.queryByRole('group', { name: QUESTION })).not.toBeInTheDocument();
            expect(preferencesStore.value?.hostedBackendQuestionAsked).toEqual([]);
        });

        it('never asks after a failed save', async () => {
            mocks.configureCloudProvider.mockRejectedValueOnce(new Error('Credential was rejected'));
            render(<AiSection />);

            fireEvent.change(screen.getByLabelText('Hosted AI API key'), { target: { value: 'sk-bad' } });
            fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

            expect(await screen.findByRole('alert')).toHaveTextContent('Credential was rejected');
            expect(screen.queryByRole('group', { name: QUESTION })).not.toBeInTheDocument();
            expect(preferencesStore.value?.hostedBackendQuestionAsked).toEqual([]);
        });
    });
});
