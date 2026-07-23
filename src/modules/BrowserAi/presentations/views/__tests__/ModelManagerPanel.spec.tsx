import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { logger } from '#/infra/logger/appLogger';

import { type DiffSingerVoicebank } from '../../../models/BrowserModel';
import { DDSP_INSTRUMENT_CATALOG } from '../../../models/DdspInstrumentCatalog';
import { type ModelRegistryState } from '../../../stores/modelRegistryStore';
import { KOKORO_MODEL_ENTRY, NSF_HIFIGAN_VOCODER } from '../../../useCases/initBrowserAi';
import { ModelManagerPanel } from '../ModelManagerPanel';

const mocks = vi.hoisted((): { registryState: ModelRegistryState | undefined } => ({
    registryState: undefined,
}));

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((_store: unknown, defaultValue: ModelRegistryState): ModelRegistryState => {
        return mocks.registryState ?? defaultValue;
    }),
}));

const use_case_mocks = vi.hoisted(() => ({
    downloadModel: vi.fn(),
    removeModel: vi.fn(),
}));

vi.mock('../../../useCases/downloadModel', () => ({
    downloadModel: use_case_mocks.downloadModel,
}));

vi.mock('../../../useCases/removeModel', () => ({
    removeModel: use_case_mocks.removeModel,
}));

function create_registry_with_unavailable_ddsp(): ModelRegistryState {
    return {
        ddspInstruments: DDSP_INSTRUMENT_CATALOG.map((instrument) => ({
            ...instrument,
            status: 'error',
            downloadProgress: 0,
        })),
        kokoroModel: null,
        diffSingerVoicebanks: [],
        vocoder: null,
        storageUsedBytes: 0,
    };
}

function create_base_registry(): ModelRegistryState {
    return {
        ddspInstruments: [],
        kokoroModel: null,
        diffSingerVoicebanks: [],
        vocoder: null,
        storageUsedBytes: 0,
    };
}

function create_voicebank(overrides: Partial<DiffSingerVoicebank>): DiffSingerVoicebank {
    const model = {
        id: 'stub',
        name: 'Stub',
        family: 'diffsinger-linguistic' as const,
        sizeBytes: 1,
        url: 'https://example.test/stub',
        license: 'Apache-2.0' as const,
        attribution: 'stub',
        nativeSampleRate: 44100,
        status: 'ready' as const,
        downloadProgress: 1,
    };
    return {
        id: 'opencpop',
        name: 'Opencpop',
        language: 'zh',
        license: 'Apache-2.0',
        attribution: 'Opencpop voicebank',
        totalSizeBytes: 150 * 1024 * 1024,
        status: 'ready',
        downloadProgress: 1,
        models: {
            linguistic: model,
            dur: model,
            pitch: model,
            variance: model,
            acoustic: model,
        },
        ...overrides,
    };
}

describe('ModelManagerPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.registryState = undefined;
    });

    it('should render DDSP instruments as unavailable when the registry marks them unavailable', () => {
        mocks.registryState = create_registry_with_unavailable_ddsp();

        render(<ModelManagerPanel />);

        expect(screen.getByText('DDSP Instruments')).toBeInTheDocument();
        expect(screen.getAllByText('Unavailable')).toHaveLength(DDSP_INSTRUMENT_CATALOG.length);
        expect(
            screen.getByLabelText('Violin unavailable: DDSP browser rendering is not available in this build')
        ).toBeInTheDocument();
        expect(screen.getAllByText('TF.js worker unavailable in this build')).toHaveLength(
            DDSP_INSTRUMENT_CATALOG.length
        );
        expect(screen.queryByText('✓ Cached')).not.toBeInTheDocument();
        expect(screen.queryByText(/available via CDN/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/Loaded from CDN/i)).not.toBeInTheDocument();
    });

    it('should render DDSP instruments as cached when the registry marks them ready', () => {
        mocks.registryState = {
            ...create_base_registry(),
            ddspInstruments: DDSP_INSTRUMENT_CATALOG.map((instrument) => ({
                ...instrument,
                status: 'ready',
                downloadProgress: 1,
            })),
        };

        render(<ModelManagerPanel />);

        expect(screen.getAllByText('✓ Cached')).toHaveLength(DDSP_INSTRUMENT_CATALOG.length);
        expect(screen.getAllByText('CDN · ~15 MB · cached by browser')).toHaveLength(DDSP_INSTRUMENT_CATALOG.length);
    });

    it('should download the Kokoro model when not-downloaded and show its download button', () => {
        mocks.registryState = create_base_registry();

        render(<ModelManagerPanel />);

        fireEvent.click(screen.getByRole('button', { name: /Download Kokoro-82M \(q8f16\)/ }));

        expect(use_case_mocks.downloadModel).toHaveBeenCalledWith({
            modelId: KOKORO_MODEL_ENTRY.id,
            family: KOKORO_MODEL_ENTRY.family,
            url: KOKORO_MODEL_ENTRY.url,
            sizeBytes: KOKORO_MODEL_ENTRY.sizeBytes,
        });
    });

    it('should render a Kokoro download progress bar while downloading', () => {
        mocks.registryState = {
            ...create_base_registry(),
            kokoroModel: { ...KOKORO_MODEL_ENTRY, status: 'downloading', downloadProgress: 0.42 },
        };

        render(<ModelManagerPanel />);

        const progressbar = screen.getByLabelText('Downloading Kokoro-82M (q8f16): 42%');
        expect(progressbar).toHaveAttribute('aria-valuenow', '42');
        expect(screen.getByText('42%')).toBeInTheDocument();
    });

    it('should remove the Kokoro model when ready and clicked', () => {
        mocks.registryState = {
            ...create_base_registry(),
            kokoroModel: { ...KOKORO_MODEL_ENTRY, status: 'ready', downloadProgress: 1 },
        };
        use_case_mocks.removeModel.mockResolvedValue(undefined);

        render(<ModelManagerPanel />);

        expect(screen.getByLabelText('Kokoro-82M (q8f16) downloaded and ready')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Remove Kokoro-82M (q8f16) from storage' }));

        expect(use_case_mocks.removeModel).toHaveBeenCalledWith({
            modelId: KOKORO_MODEL_ENTRY.id,
            family: KOKORO_MODEL_ENTRY.family,
        });
    });

    it('should log an error when removing a model fails', async () => {
        mocks.registryState = {
            ...create_base_registry(),
            kokoroModel: { ...KOKORO_MODEL_ENTRY, status: 'ready', downloadProgress: 1 },
        };
        const removal_failure = new Error('OPFS delete denied');
        use_case_mocks.removeModel.mockRejectedValue(removal_failure);
        const logger_error_spy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);

        render(<ModelManagerPanel />);
        fireEvent.click(screen.getByRole('button', { name: 'Remove Kokoro-82M (q8f16) from storage' }));

        await vi.waitFor(() => {
            expect(logger_error_spy).toHaveBeenCalledTimes(1);
        });
        const logged = logger_error_spy.mock.calls[0]?.[0] as Error;
        expect(logged.message).toContain('Failed to remove model "kokoro-82m-q8"');
        expect(logged.cause).toBe(removal_failure);

        logger_error_spy.mockRestore();
    });

    it('should retry the vocoder download when its status is error', () => {
        mocks.registryState = {
            ...create_base_registry(),
            vocoder: { ...NSF_HIFIGAN_VOCODER, status: 'error', downloadProgress: 0 },
        };

        render(<ModelManagerPanel />);

        expect(screen.getByLabelText('NSF-HiFiGAN 44.1k download failed')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Retry downloading NSF-HiFiGAN 44.1k' }));

        expect(use_case_mocks.downloadModel).toHaveBeenCalledWith({
            modelId: NSF_HIFIGAN_VOCODER.id,
            family: NSF_HIFIGAN_VOCODER.family,
            url: NSF_HIFIGAN_VOCODER.url,
            sizeBytes: NSF_HIFIGAN_VOCODER.sizeBytes,
        });
    });

    it('should render an empty voice-pack message when no DiffSinger voicebanks are installed', () => {
        mocks.registryState = create_base_registry();

        render(<ModelManagerPanel />);

        expect(screen.getByText('No voice packs installed.')).toBeInTheDocument();
    });

    it('should render a DiffSinger voicebank download progress bar', () => {
        mocks.registryState = {
            ...create_base_registry(),
            diffSingerVoicebanks: [create_voicebank({ status: 'downloading', downloadProgress: 0.3 })],
        };

        render(<ModelManagerPanel />);

        expect(screen.getByLabelText('Downloading Opencpop: 30%')).toBeInTheDocument();
    });

    it('should remove all five sub-models when a ready voicebank is removed', () => {
        mocks.registryState = {
            ...create_base_registry(),
            diffSingerVoicebanks: [create_voicebank({ status: 'ready', downloadProgress: 1 })],
        };
        use_case_mocks.removeModel.mockResolvedValue(undefined);

        render(<ModelManagerPanel />);

        fireEvent.click(screen.getByRole('button', { name: 'Remove Opencpop voicebank' }));

        expect(use_case_mocks.removeModel).toHaveBeenCalledTimes(5);
        expect(use_case_mocks.removeModel).toHaveBeenCalledWith({
            modelId: 'linguistic',
            family: 'diffsinger/opencpop',
        });
        expect(use_case_mocks.removeModel).toHaveBeenCalledWith({ modelId: 'acoustic', family: 'diffsinger/opencpop' });
    });

    it('should render an error badge for a voicebank that failed', () => {
        mocks.registryState = {
            ...create_base_registry(),
            diffSingerVoicebanks: [create_voicebank({ status: 'error', downloadProgress: 0 })],
        };

        render(<ModelManagerPanel />);

        expect(screen.getByLabelText('Opencpop not ready')).toBeInTheDocument();
        expect(screen.getByText('Error')).toBeInTheDocument();
    });

    it('should render a not-ready badge for a voicebank that is neither downloading, ready, nor error', () => {
        mocks.registryState = {
            ...create_base_registry(),
            diffSingerVoicebanks: [create_voicebank({ status: 'not-downloaded', downloadProgress: 0 })],
        };

        render(<ModelManagerPanel />);

        expect(screen.getByText('Not ready')).toBeInTheDocument();
    });

    it('should flag storage usage near the 2 GB limit', () => {
        mocks.registryState = {
            ...create_base_registry(),
            storageUsedBytes: 1.9 * 1024 * 1024 * 1024,
        };

        render(<ModelManagerPanel />);

        expect(screen.getByLabelText('Storage used: 95% of 2 GB')).toBeInTheDocument();
    });
});
