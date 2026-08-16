import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AiSection } from '../AiSection';

const mocks = vi.hoisted(() => ({
    backendPreference: { value: 'auto' },
    configureCloudProvider: vi.fn(),
    hostedProvider: { value: null },
    llmStatus: { value: { state: 'idle' } },
    removeCloudApi: vi.fn(),
    resolveBackend: vi.fn(() => 'none'),
    setAiBackendPreference: vi.fn(),
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
    aiBackendPreferenceStore: {},
    hostedLlmProviderStatusStore: {},
    llmStatusStore: {},
}));

vi.mock('#/modules/AiRuntime/useCases', () => ({
    configureCloudProvider: mocks.configureCloudProvider,
    removeCloudApi: mocks.removeCloudApi,
    resolveBackend: mocks.resolveBackend,
    setAiBackendPreference: mocks.setAiBackendPreference,
}));

vi.mock('#/modules/BrowserAi/presentations/views', () => ({
    CapabilityReportPanel: () => <div data-testid="capability-report-panel" />,
    ModelManagerPanel: () => <div data-testid="model-manager-panel" />,
}));

describe('AiSection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.backendPreference.value = 'auto';
        mocks.hostedProvider.value = null;
        mocks.llmStatus.value = { state: 'idle' };
        mocks.resolveBackend.mockReturnValue('none');
    });

    it('keeps automatic browser-local and makes hosted selection explicit', () => {
        render(<AiSection />);

        expect(screen.getByRole('option', { name: 'Automatic' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Browser WebLLM' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Hosted provider' })).toBeInTheDocument();
        expect(screen.getByText(/Automatic uses WebLLM in this browser only/)).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('AI execution backend'), { target: { value: 'cloud' } });
        expect(mocks.setAiBackendPreference).toHaveBeenCalledWith('cloud');
    });

    it('configures an explicitly selected hosted provider without exposing a retired option', () => {
        render(<AiSection />);

        fireEvent.change(screen.getByLabelText('Anthropic API key'), { target: { value: 'sk-test' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(mocks.configureCloudProvider).toHaveBeenCalledWith({
            provider: 'anthropic',
            apiKey: 'sk-test',
            model: 'claude-sonnet-5',
            baseUrl: undefined,
        });
        expect(screen.queryByRole('option', { name: /native/i })).not.toBeInTheDocument();
    });
});
