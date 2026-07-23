import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { AiSection } from '../AiSection';

const mockConfigureCloudApi = vi.fn();
const mockRemoveCloudApi = vi.fn();
const mockIsCloudAvailable = vi.fn(() => false);
type MockAiBackend = 'native' | 'cloud' | 'webllm' | 'none';
const mockResolveBackend = vi.fn((): MockAiBackend => 'none');

vi.mock('#/modules/AiRuntime/useCases', () => ({
    configureCloudApi: (key: string) => mockConfigureCloudApi(key),
    removeCloudApi: () => mockRemoveCloudApi(),
    isCloudAvailable: () => mockIsCloudAvailable(),
    resolveBackend: () => mockResolveBackend(),
}));

vi.mock('#/modules/BrowserAi/presentations/views', () => ({
    CapabilityReportPanel: () => <div data-testid="capability-report-panel" />,
    ModelManagerPanel: () => <div data-testid="model-manager-panel" />,
}));

describe('AiSection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIsCloudAvailable.mockReturnValue(false);
        mockResolveBackend.mockReturnValue('none');
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

    it('shows "Native (in-process)" when the backend resolves to native', () => {
        mockResolveBackend.mockReturnValue('native');
        render(<AiSection />);

        expect(screen.getByText('Native (in-process)')).toBeInTheDocument();
    });

    it('shows "Cloud (Claude)" when the backend resolves to cloud', () => {
        mockResolveBackend.mockReturnValue('cloud');
        render(<AiSection />);

        expect(screen.getByText('Cloud (Claude)')).toBeInTheDocument();
    });

    it('shows "Browser (WebLLM)" when the backend resolves to webllm', () => {
        mockResolveBackend.mockReturnValue('webllm');
        render(<AiSection />);

        expect(screen.getByText('Browser (WebLLM)')).toBeInTheDocument();
    });

    it('shows "Connected" and a Remove Key button when cloud is available', () => {
        mockIsCloudAvailable.mockReturnValue(true);
        render(<AiSection />);

        expect(screen.getByText('Connected')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Remove Key' }));

        expect(mockRemoveCloudApi).toHaveBeenCalled();
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

    it('configures the cloud API with the trimmed key and clears the input on save', () => {
        render(<AiSection />);

        const input = screen.getByLabelText('Anthropic API key') as HTMLInputElement;
        fireEvent.change(input, { target: { value: '  sk-ant-test  ' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(mockConfigureCloudApi).toHaveBeenCalledWith('sk-ant-test');
        expect(input.value).toBe('');
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
