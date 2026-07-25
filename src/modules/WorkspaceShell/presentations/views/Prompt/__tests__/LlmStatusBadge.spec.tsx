import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { LlmStatusBadge } from '../LlmStatusBadge';

const module_mocks = vi.hoisted(() => {
    const nativeModelInfo = {
        id: 'qwen3-8b-native',
        displayName: 'Qwen3 8B',
        description: 'In-process inference via Metal/CUDA GPU.',
        downloadSize: '~5.0 GB (first run only)',
        ramUsage: '~6.0 GB',
        parameterCount: '8B',
        huggingFaceId: 'Qwen/Qwen3-8B',
    };

    const cloudModelInfo = {
        id: 'claude-cloud',
        displayName: 'Claude',
        description: 'Cloud-hosted assistant.',
        downloadSize: 'n/a',
        ramUsage: 'n/a',
        parameterCount: 'n/a',
    };

    const webllmModels = [
        {
            id: 'Qwen3-1.7B-q4f16_1-MLC',
            displayName: 'Light',
            description: 'Fast responses, low resource usage.',
            downloadSize: '~1.1 GB',
            ramUsage: '~1.8 GB',
            parameterCount: '1.7B',
        },
        {
            id: 'Qwen3-4B-q4f16_1-MLC',
            displayName: 'Standard',
            description: 'Good quality with moderate resource usage.',
            downloadSize: '~2.5 GB',
            ramUsage: '~3.5 GB',
            parameterCount: '4B',
        },
    ];

    return {
        is_llm_available: vi.fn(() => true),
        resolve_backend: vi.fn<() => 'native' | 'webllm' | 'cloud' | 'none'>(() => 'webllm'),
        unload_engine: vi.fn(() => Promise.resolve()),
        get_active_model_id: vi.fn(() => 'Qwen3-4B-q4f16_1-MLC'),
        native_model_info: nativeModelInfo,
        cloud_model_info: cloudModelInfo,
        webllm_models: webllmModels,
    };
});

vi.mock('#/modules/AiRuntime/useCases', () => ({
    isLlmAvailable: module_mocks.is_llm_available,
    resolveBackend: module_mocks.resolve_backend,
    unloadEngine: module_mocks.unload_engine,
    getActiveModelId: module_mocks.get_active_model_id,
    NATIVE_MODEL_INFO: module_mocks.native_model_info,
    CLOUD_MODEL_INFO: module_mocks.cloud_model_info,
    WEBLLM_MODELS: module_mocks.webllm_models,
}));

describe('LlmStatusBadge', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        module_mocks.is_llm_available.mockReturnValue(true);
        module_mocks.resolve_backend.mockReturnValue('webllm');
        module_mocks.unload_engine.mockResolvedValue(undefined);
        module_mocks.get_active_model_id.mockReturnValue('Qwen3-4B-q4f16_1-MLC');
    });

    it('renders a No GPU notice when no LLM backend is available', () => {
        module_mocks.is_llm_available.mockReturnValue(false);

        render(<LlmStatusBadge status={{ state: 'idle' }} onLoad={vi.fn()} />);

        expect(screen.getByText('No GPU')).toBeInTheDocument();
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('shows a webllm load button naming the currently selected model', () => {
        render(<LlmStatusBadge status={{ state: 'idle' }} onLoad={vi.fn()} />);

        expect(screen.getByRole('button', { name: /Load AI/ })).toBeInTheDocument();
    });

    it('opens the model picker and loads the selected webllm model', () => {
        const onLoad = vi.fn();
        render(<LlmStatusBadge status={{ state: 'idle' }} onLoad={onLoad} />);

        fireEvent.click(screen.getByRole('button', { name: /Load AI/ }));

        expect(screen.getByText('Light')).toBeInTheDocument();
        expect(screen.getByText('Standard')).toBeInTheDocument();

        fireEvent.click(screen.getByText('Light'));
        fireEvent.click(screen.getByRole('button', { name: /Load Light/ }));

        expect(onLoad).toHaveBeenCalledWith('Qwen3-1.7B-q4f16_1-MLC');
    });

    it('starts the native engine without a model id when the backend is native', () => {
        module_mocks.resolve_backend.mockReturnValue('native');
        const onLoad = vi.fn();
        render(<LlmStatusBadge status={{ state: 'idle' }} onLoad={onLoad} />);

        fireEvent.click(screen.getByRole('button', { name: /Load AI/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Start Native Engine' }));

        expect(onLoad).toHaveBeenCalledWith(undefined);
    });

    it('connects to cloud AI without a model id when the backend is cloud', () => {
        module_mocks.resolve_backend.mockReturnValue('cloud');
        const onLoad = vi.fn();
        render(<LlmStatusBadge status={{ state: 'idle' }} onLoad={onLoad} />);

        fireEvent.click(screen.getByRole('button', { name: /Load AI/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Connect Cloud AI' }));

        expect(onLoad).toHaveBeenCalledWith(undefined);
    });

    it('shows a rounded loading percentage while a model downloads', () => {
        render(
            <LlmStatusBadge
                status={{ state: 'loading', progress: 0.42, text: 'Downloading weights' }}
                onLoad={vi.fn()}
            />
        );

        expect(screen.getByText('42%')).toBeInTheDocument();
    });

    it('shows an AI Ready pill and unloads the engine from its panel', () => {
        render(<LlmStatusBadge status={{ state: 'ready', modelId: 'Qwen3-4B-q4f16_1-MLC' }} onLoad={vi.fn()} />);

        fireEvent.click(screen.getByRole('button', { name: /AI Ready/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Unload from Memory' }));

        expect(module_mocks.unload_engine).toHaveBeenCalledTimes(1);
    });

    it('shows a generating indicator while the model is thinking', () => {
        render(<LlmStatusBadge status={{ state: 'generating' }} onLoad={vi.fn()} />);

        expect(screen.getByText('Thinking…')).toBeInTheDocument();
    });

    it('shows a retry button with the error message as its title on failure', () => {
        const onLoad = vi.fn();
        render(<LlmStatusBadge status={{ state: 'error', message: 'Failed to load model' }} onLoad={onLoad} />);

        const retryButton = screen.getByRole('button', { name: /AI Error/ });
        expect(retryButton).toHaveAttribute('title', 'Failed to load model');

        fireEvent.click(retryButton);

        expect(onLoad).toHaveBeenCalledWith();
    });

    describe('backend panel content', () => {
        it('shows the native model description and specs in the idle panel', () => {
            module_mocks.resolve_backend.mockReturnValue('native');
            render(<LlmStatusBadge status={{ state: 'idle' }} onLoad={vi.fn()} />);

            fireEvent.click(screen.getByRole('button', { name: /Load AI/ }));

            expect(screen.getByText('In-process inference via Metal/CUDA GPU.')).toBeInTheDocument();
            expect(screen.getByText('~5.0 GB (first run only)')).toBeInTheDocument();
            expect(screen.getByText('~6.0 GB')).toBeInTheDocument();
        });

        it('shows the cloud model description in the idle panel', () => {
            module_mocks.resolve_backend.mockReturnValue('cloud');
            render(<LlmStatusBadge status={{ state: 'idle' }} onLoad={vi.fn()} />);

            fireEvent.click(screen.getByRole('button', { name: /Load AI/ }));

            expect(screen.getByText('Cloud-hosted assistant.')).toBeInTheDocument();
            expect(screen.getByText('Connect Cloud AI')).toBeInTheDocument();
        });

        it('shows the native display name and RAM in the ready panel', () => {
            module_mocks.resolve_backend.mockReturnValue('native');
            render(<LlmStatusBadge status={{ state: 'ready', modelId: 'qwen3-8b-native' }} onLoad={vi.fn()} />);

            fireEvent.click(screen.getByRole('button', { name: /AI Ready/ }));

            expect(screen.getByText('Qwen3 8B')).toBeInTheDocument();
            expect(screen.getByText(/~6.0 GB RAM/)).toBeInTheDocument();
        });
    });

    describe('panel dismissal', () => {
        it('closes the idle panel when clicking outside', () => {
            render(<LlmStatusBadge status={{ state: 'idle' }} onLoad={vi.fn()} />);

            fireEvent.click(screen.getByRole('button', { name: /Load AI/ }));
            expect(screen.getByText('Light')).toBeInTheDocument();

            // Click outside the panel.
            fireEvent.mouseDown(document.body);

            expect(screen.queryByText('Light')).not.toBeInTheDocument();
        });

        it('closes the ready panel when clicking outside', () => {
            render(<LlmStatusBadge status={{ state: 'ready', modelId: 'Qwen3-4B-q4f16_1-MLC' }} onLoad={vi.fn()} />);

            fireEvent.click(screen.getByRole('button', { name: /AI Ready/ }));
            expect(screen.getByText('Unload from Memory')).toBeInTheDocument();

            fireEvent.mouseDown(document.body);

            expect(screen.queryByText('Unload from Memory')).not.toBeInTheDocument();
        });
    });
});
