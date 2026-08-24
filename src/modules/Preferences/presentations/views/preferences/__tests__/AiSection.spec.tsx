import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AiSection } from '../AiSection';

const mocks = vi.hoisted(() => ({
    admission: { webLlm: true },
    backendPreference: { value: 'auto' },
    configureCloudProvider: vi.fn(),
    hostedProvider: { value: null },
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
    aiBackendPreferenceStore: {},
    hostedLlmProviderStatusStore: {},
    llmStatusStore: {},
}));

vi.mock('#/modules/AiRuntime/useCases', () => ({
    configureCloudProvider: mocks.configureCloudProvider,
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

describe('AiSection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.admission.webLlm = true;
        mocks.backendPreference.value = 'auto';
        mocks.hostedProvider.value = null;
        mocks.isDesktop = true;
        mocks.llmStatus.value = { state: 'idle' };
        mocks.resolveBackend.mockReturnValue('none');
    });

    it('offers Browser WebLLM alongside desktop hosted selection', () => {
        render(<AiSection />);

        expect(screen.getByRole('option', { name: 'Automatic' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Browser WebLLM' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Hosted provider' })).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('AI execution backend'), { target: { value: 'webllm' } });
        expect(mocks.setAiBackendPreference).toHaveBeenCalledWith('webllm');
    });

    it('configures an explicitly selected hosted provider without exposing a retired option', async () => {
        render(<AiSection />);

        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => {
            expect(mocks.configureCloudProvider).toHaveBeenCalledWith({
                provider: 'anthropic',
                model: 'claude-sonnet-5',
                baseUrl: undefined,
            });
        });
        expect(screen.queryByRole('option', { name: /native/i })).not.toBeInTheDocument();
    });

    it('exposes no hosted credential surface in web builds', () => {
        mocks.isDesktop = false;
        render(<AiSection />);

        expect(screen.queryByRole('option', { name: 'Hosted provider' })).not.toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Browser WebLLM' })).toBeInTheDocument();
        expect(screen.queryByLabelText(/API key/u)).not.toBeInTheDocument();
        expect(screen.getByText(/Web builds never accept provider credentials/u)).toBeInTheDocument();
    });

    it('keeps Automatic selected in web builds when the persisted preference is auto', () => {
        mocks.isDesktop = false;
        mocks.backendPreference.value = 'auto';
        mocks.resolveBackend.mockReturnValue('none');

        render(<AiSection />);

        expect(screen.getByLabelText('AI execution backend')).toHaveValue('auto');
    });

    it('reflects an explicit WebLLM preference in web builds', () => {
        mocks.isDesktop = false;
        mocks.backendPreference.value = 'webllm';
        mocks.resolveBackend.mockReturnValue('webllm');

        render(<AiSection />);

        expect(screen.getByLabelText('AI execution backend')).toHaveValue('webllm');
    });

    it('hides Browser WebLLM and falls back to Automatic when admission is off', () => {
        mocks.admission.webLlm = false;
        mocks.isDesktop = false;

        render(<AiSection />);

        expect(screen.queryByRole('option', { name: 'Browser WebLLM' })).not.toBeInTheDocument();
        expect(screen.getByLabelText('AI execution backend')).toHaveValue('auto');
    });

    it('resolves a stale persisted WebLLM preference to Automatic when admission is off', () => {
        mocks.admission.webLlm = false;
        mocks.isDesktop = false;
        mocks.backendPreference.value = 'webllm';
        mocks.resolveBackend.mockReturnValue('webllm');

        render(<AiSection />);

        expect(screen.getByLabelText('AI execution backend')).toHaveValue('auto');
    });

    it('resolves a stale persisted cloud preference to Automatic in web builds', () => {
        mocks.isDesktop = false;
        mocks.backendPreference.value = 'cloud';
        mocks.resolveBackend.mockReturnValue('cloud');

        render(<AiSection />);

        expect(screen.getByLabelText('AI execution backend')).toHaveValue('auto');
    });
});
