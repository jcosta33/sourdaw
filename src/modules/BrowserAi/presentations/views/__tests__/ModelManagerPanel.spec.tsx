import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { logger } from '#/infra/logger/appLogger';

import { DDSP_INSTRUMENT_CATALOG } from '../../../models/DdspInstrumentCatalog';
import { type ModelRegistryState } from '../../../stores/modelRegistryStore';
import { KOKORO_MODEL_ENTRY } from '../../../useCases/initBrowserAi';
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

    it('should flag storage usage near the 2 GB limit', () => {
        mocks.registryState = {
            ...create_base_registry(),
            storageUsedBytes: 1.9 * 1024 * 1024 * 1024,
        };

        render(<ModelManagerPanel />);

        expect(screen.getByLabelText('Storage used: 95% of 2 GB')).toBeInTheDocument();
    });
});
