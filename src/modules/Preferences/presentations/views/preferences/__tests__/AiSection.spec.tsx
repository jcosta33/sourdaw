import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { AiSection } from '../AiSection';

const mockConfigureCloudProvider = vi.fn<(configuration: unknown) => void>();
const mockRemoveCloudApi = vi.fn<() => void>();
const mockSetAiBackendPreference = vi.fn<(preference: string) => void>();
const mockNativeAvailable = { value: false };
const mockBackendPreference = { value: 'auto' };
const mockLlmStatus = {
    value: { state: 'idle' } as
        { state: 'idle' } | { state: 'ready'; backend: 'native' | 'cloud' | 'webllm'; modelId: string },
};
const mockHostedProviderStatus: {
    value: {
        provider: 'anthropic' | 'openai' | 'openai-compatible';
        model: string;
        baseUrl: string | null;
    } | null;
} = { value: null };
type MockAiBackend = 'native' | 'cloud' | 'webllm' | 'none';
const mockResolveBackend = vi.fn((): MockAiBackend => 'none');

vi.mock('#/infra/store/useStore', () => ({
    useStore: (_store: unknown, fallback: unknown) => {
        if (fallback === 'auto') {
            return mockBackendPreference.value;
        }
        if (fallback === null) {
            return mockHostedProviderStatus.value;
        }
        return mockLlmStatus.value;
    },
}));

vi.mock('#/modules/AiRuntime/stores', () => ({
    aiBackendPreferenceStore: {},
    hostedLlmProviderStatusStore: {},
    llmStatusStore: {},
}));

vi.mock('#/modules/AiRuntime/useCases', () => ({
    configureCloudProvider: (configuration: unknown): void => {
        mockConfigureCloudProvider(configuration);
    },
    removeCloudApi: (): void => {
        mockRemoveCloudApi();
    },
    isNativeAiRuntimeAvailable: () => mockNativeAvailable.value,
    resolveBackend: () => mockResolveBackend(),
    setAiBackendPreference: (preference: string): void => {
        mockSetAiBackendPreference(preference);
        mockBackendPreference.value = preference;
        if (
            preference !== 'auto' &&
            mockLlmStatus.value.state === 'ready' &&
            mockLlmStatus.value.backend !== preference
        ) {
            mockLlmStatus.value = { state: 'idle' };
        }
    },
}));

vi.mock('#/modules/BrowserAi/presentations/views', () => ({
    CapabilityReportPanel: () => <div data-testid="capability-report-panel" />,
    ModelManagerPanel: () => <div data-testid="model-manager-panel" />,
}));

describe('AiSection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockHostedProviderStatus.value = null;
        mockBackendPreference.value = 'auto';
        mockLlmStatus.value = { state: 'idle' };
        mockResolveBackend.mockReturnValue('none');
        mockNativeAvailable.value = false;
    });

    it('renders the browser AI and model manager panels', () => {
        render(<AiSection />);

        expect(screen.getByTestId('capability-report-panel')).toBeInTheDocument();
        expect(screen.getByTestId('model-manager-panel')).toBeInTheDocument();
    });

    it('shows "None" for an unresolved backend and "Not configured" when cloud is unavailable', () => {
        render(<AiSection />);

        expect(screen.getByText('None')).toBeInTheDocument();
        expect(screen.getByText('Not configured')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Remove Key' })).not.toBeInTheDocument();
    });

    it('hides automatic and native backend choices in the browser', () => {
        render(<AiSection />);

        const backend = screen.getByLabelText('AI execution backend');
        expect(backend).toHaveValue('webllm');
        expect(screen.queryByRole('option', { name: /Automatic/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('option', { name: 'Native local' })).not.toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Browser WebLLM' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Hosted provider' })).toBeInTheDocument();

        const model = screen.getByLabelText('Hosted AI model');
        expect(model.tagName).toBe('SELECT');
        expect(model).toHaveValue('claude-sonnet-5');
        expect(screen.getByRole('option', { name: 'Claude Fable 5 — Highest quality' })).toBeInTheDocument();
    });

    it('shows native local only when the desktop runtime is available', () => {
        mockNativeAvailable.value = true;
        mockResolveBackend.mockReturnValue('native');
        render(<AiSection />);

        expect(screen.getByRole('option', { name: 'Automatic local failover' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Native local' })).toBeInTheDocument();
        expect(screen.getByText('Native (in-process)')).toBeInTheDocument();
        expect(
            screen.getByText(
                'Automatic stays local and fails over between native local and WebLLM. Select Hosted provider explicitly to send prompts remotely.'
            )
        ).toBeInTheDocument();
    });

    it('shows the configured hosted provider when the backend resolves to cloud', () => {
        mockResolveBackend.mockReturnValue('cloud');
        mockHostedProviderStatus.value = {
            provider: 'anthropic',
            model: 'claude-sonnet-5',
            baseUrl: null,
        };
        render(<AiSection />);

        expect(screen.getByText('Cloud (Anthropic)')).toBeInTheDocument();
    });

    it('shows "Browser (WebLLM)" when the backend resolves to webllm', () => {
        mockResolveBackend.mockReturnValue('webllm');
        render(<AiSection />);

        expect(screen.getByText('Browser (WebLLM)')).toBeInTheDocument();
    });

    it('shows a configured provider and a Remove Key button when cloud is available', () => {
        mockHostedProviderStatus.value = {
            provider: 'anthropic',
            model: 'claude-sonnet-4-20250514',
            baseUrl: null,
        };
        render(<AiSection />);

        expect(screen.getByText('Configured: Anthropic / claude-sonnet-4-20250514')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Remove Key' }));

        expect(mockRemoveCloudApi).toHaveBeenCalled();
    });

    it('routes an explicit backend preference and clears an incompatible ready backend', () => {
        mockLlmStatus.value = { state: 'ready', backend: 'webllm', modelId: 'local-browser-model' };
        mockResolveBackend.mockReturnValue('cloud');
        const { rerender } = render(<AiSection />);

        fireEvent.change(screen.getByLabelText('AI execution backend'), { target: { value: 'cloud' } });
        rerender(<AiSection />);

        expect(mockSetAiBackendPreference).toHaveBeenCalledWith('cloud');
        expect(screen.getByText('Cloud (Hosted)')).toBeInTheDocument();
    });

    it('keeps the Save button disabled until an API key is entered', () => {
        render(<AiSection />);

        const saveButton = screen.getByRole('button', { name: 'Save' });
        expect(saveButton).toBeDisabled();

        fireEvent.change(screen.getByLabelText('Anthropic API key'), { target: { value: '   ' } });
        expect(saveButton).toBeDisabled();

        fireEvent.change(screen.getByLabelText('Anthropic API key'), { target: { value: 'sk-ant-test' } });
        expect(saveButton).not.toBeDisabled();
    });

    it('submits hosted configuration and clears the key input on save', () => {
        render(<AiSection />);

        const input = screen.getByLabelText('Anthropic API key') as HTMLInputElement;
        fireEvent.change(input, { target: { value: '  sk-ant-test  ' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(mockConfigureCloudProvider).toHaveBeenCalledWith({
            provider: 'anthropic',
            apiKey: '  sk-ant-test  ',
            model: 'claude-sonnet-5',
            baseUrl: undefined,
        });
        expect(input.value).toBe('');
    });

    it('configures OpenAI and an arbitrary compatible endpoint', () => {
        render(<AiSection />);

        fireEvent.change(screen.getByLabelText('Hosted AI provider'), { target: { value: 'openai' } });
        expect(screen.getByLabelText('Hosted AI model').tagName).toBe('SELECT');
        expect(screen.getByLabelText('Hosted AI model')).toHaveValue('gpt-5.6-terra');
        expect(screen.getByRole('option', { name: 'GPT-5.6 Sol — Highest quality' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'GPT-5.6 Terra — Recommended' })).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('OpenAI API key'), { target: { value: 'sk-openai' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(mockConfigureCloudProvider).toHaveBeenLastCalledWith({
            provider: 'openai',
            apiKey: 'sk-openai',
            model: 'gpt-5.6-terra',
            baseUrl: undefined,
        });

        fireEvent.change(screen.getByLabelText('Hosted AI provider'), {
            target: { value: 'openai-compatible' },
        });
        expect(screen.getByLabelText('Hosted AI model').tagName).toBe('INPUT');
        fireEvent.change(screen.getByLabelText('Hosted AI model'), { target: { value: 'qwen-local' } });
        fireEvent.change(screen.getByLabelText('OpenAI-compatible base URL'), {
            target: { value: 'http://localhost:1234/v1' },
        });
        fireEvent.change(screen.getByLabelText('OpenAI-compatible API key'), { target: { value: 'local-key' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(mockConfigureCloudProvider).toHaveBeenLastCalledWith({
            provider: 'openai-compatible',
            apiKey: 'local-key',
            model: 'qwen-local',
            baseUrl: 'http://localhost:1234/v1',
        });
    });

    it('preserves a configured first-party custom model and resubmits it without retyping', () => {
        mockHostedProviderStatus.value = {
            provider: 'anthropic',
            model: 'claude-private-preview',
            baseUrl: null,
        };
        render(<AiSection />);

        expect(screen.getByLabelText('Hosted AI model')).toHaveValue('custom');
        expect(screen.getByLabelText('Custom Anthropic model ID')).toHaveValue('claude-private-preview');

        fireEvent.change(screen.getByLabelText('Anthropic API key'), { target: { value: 'sk-ant-test' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(mockConfigureCloudProvider).toHaveBeenCalledWith({
            provider: 'anthropic',
            apiKey: 'sk-ant-test',
            model: 'claude-private-preview',
            baseUrl: undefined,
        });
    });

    it('clears credential drafts when their provider or compatible endpoint changes', () => {
        render(<AiSection />);

        fireEvent.change(screen.getByLabelText('Anthropic API key'), { target: { value: 'anthropic-secret' } });
        fireEvent.change(screen.getByLabelText('Hosted AI provider'), { target: { value: 'openai' } });

        expect(screen.getByLabelText('OpenAI API key')).toHaveValue('');
        expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

        fireEvent.change(screen.getByLabelText('Hosted AI provider'), {
            target: { value: 'openai-compatible' },
        });
        fireEvent.change(screen.getByLabelText('Hosted AI model'), { target: { value: 'local-model' } });
        fireEvent.change(screen.getByLabelText('OpenAI-compatible base URL'), {
            target: { value: 'http://localhost:1234/v1' },
        });
        fireEvent.change(screen.getByLabelText('OpenAI-compatible API key'), {
            target: { value: 'local-secret' },
        });
        fireEvent.change(screen.getByLabelText('OpenAI-compatible base URL'), {
            target: { value: 'http://localhost:4321/v1' },
        });

        expect(screen.getByLabelText('OpenAI-compatible API key')).toHaveValue('');
        expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled();
    });

    it('allows an auth-free OpenAI-compatible endpoint', () => {
        render(<AiSection />);

        fireEvent.change(screen.getByLabelText('Hosted AI provider'), {
            target: { value: 'openai-compatible' },
        });
        fireEvent.change(screen.getByLabelText('Hosted AI model'), { target: { value: 'qwen-local' } });
        fireEvent.change(screen.getByLabelText('OpenAI-compatible base URL'), {
            target: { value: 'http://localhost:1234/v1' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(mockConfigureCloudProvider).toHaveBeenLastCalledWith({
            provider: 'openai-compatible',
            apiKey: '',
            model: 'qwen-local',
            baseUrl: 'http://localhost:1234/v1',
        });
    });

    it('renders provider configuration errors without crashing Preferences', () => {
        mockConfigureCloudProvider.mockImplementationOnce(() => {
            throw new Error('Provider base URL is invalid');
        });
        render(<AiSection />);

        fireEvent.change(screen.getByLabelText('Anthropic API key'), { target: { value: 'sk-ant-test' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(screen.getByRole('alert')).toHaveTextContent('Provider base URL is invalid');
    });

    it('toggles the API key input between password and text when the eye button is clicked', () => {
        render(<AiSection />);

        const input = screen.getByLabelText('Anthropic API key');
        expect(input).toHaveAttribute('type', 'password');

        fireEvent.click(screen.getByRole('button', { name: 'Show API key' }));
        expect(input).toHaveAttribute('type', 'text');

        fireEvent.click(screen.getByRole('button', { name: 'Hide API key' }));
        expect(input).toHaveAttribute('type', 'password');
    });
});
