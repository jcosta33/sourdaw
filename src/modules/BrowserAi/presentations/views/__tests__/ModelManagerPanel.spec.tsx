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
    downloadDdspInstrument: vi.fn(),
    downloadModel: vi.fn(),
    removeDdspInstrument: vi.fn(),
    removeModel: vi.fn(),
}));

vi.mock('../../../useCases/downloadModel', () => ({
    downloadModel: use_case_mocks.downloadModel,
}));

vi.mock('../../../useCases/downloadDdspInstrument', () => ({
    downloadDdspInstrument: use_case_mocks.downloadDdspInstrument,
}));

vi.mock('../../../useCases/removeDdspInstrument', () => ({
    removeDdspInstrument: use_case_mocks.removeDdspInstrument,
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
        use_case_mocks.downloadDdspInstrument.mockResolvedValue(undefined);
        use_case_mocks.downloadModel.mockResolvedValue(undefined);
        use_case_mocks.removeDdspInstrument.mockResolvedValue(undefined);
        use_case_mocks.removeModel.mockResolvedValue(undefined);
    });

    it('should show admitted DDSP checkpoints as direct Magenta downloads, never a browser cache claim', () => {
        mocks.registryState = create_base_registry();

        render(<ModelManagerPanel />);

        expect(screen.getByText('DDSP Instruments')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Download Violin from Magenta' })).toBeInTheDocument();
        expect(screen.queryByText(/cached by browser/i)).not.toBeInTheDocument();
    });

    it('should show a useful failed state and retry action for a DDSP registry error', () => {
        mocks.registryState = create_registry_with_unavailable_ddsp();

        render(<ModelManagerPanel />);

        expect(screen.getByLabelText(/Violin download failed.*network.*integrity.*storage/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Retry downloading Violin' })).toBeEnabled();
        expect(screen.queryByRole('button', { name: 'Download Violin from Magenta' })).not.toBeInTheDocument();
    });

    it('should show DDSP download progress and disable a second launch while that instrument is downloading', () => {
        mocks.registryState = {
            ...create_base_registry(),
            ddspInstruments: [
                {
                    ...DDSP_INSTRUMENT_CATALOG[0],
                    status: 'downloading',
                    downloadProgress: 0.42,
                },
            ],
        };

        render(<ModelManagerPanel />);

        expect(screen.getByLabelText('Downloading Violin: 42%')).toHaveAttribute('aria-valuenow', '42');
        expect(screen.getByText('42%')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Download Violin from Magenta' })).not.toBeInTheDocument();
    });

    it.each([new Error('network request rejected'), new Error('integrity mismatch'), new Error('OPFS write denied')])(
        'should keep the failed retry UI and report a rejected DDSP action: %s',
        async (failure) => {
            mocks.registryState = create_registry_with_unavailable_ddsp();
            use_case_mocks.downloadDdspInstrument.mockRejectedValue(failure);
            const loggerError = vi.spyOn(logger, 'error').mockImplementation(() => undefined);

            render(<ModelManagerPanel />);
            fireEvent.click(screen.getByRole('button', { name: 'Retry downloading Violin' }));

            await vi.waitFor(() => expect(loggerError).toHaveBeenCalledTimes(1));
            const logged = loggerError.mock.calls[0]?.[0];
            expect(logged).toBeInstanceOf(Error);
            expect((logged as Error).cause).toBe(failure);
            expect(screen.getByRole('button', { name: 'Retry downloading Violin' })).toBeEnabled();
            expect(screen.getAllByText('Failed')).toHaveLength(DDSP_INSTRUMENT_CATALOG.length);
            loggerError.mockRestore();
        }
    );

    it('should disable a DDSP retry while the existing download flow is in flight', async () => {
        mocks.registryState = create_registry_with_unavailable_ddsp();
        let finish = (): void => undefined;
        use_case_mocks.downloadDdspInstrument.mockImplementation(
            () =>
                new Promise<void>((resolve) => {
                    finish = resolve;
                })
        );

        render(<ModelManagerPanel />);
        fireEvent.click(screen.getByRole('button', { name: 'Retry downloading Violin' }));

        await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Retrying Violin download' })).toBeDisabled());
        expect(use_case_mocks.downloadDdspInstrument).toHaveBeenCalledOnce();
        finish();
        await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Retry downloading Violin' })).toBeEnabled());
    });

    it('should log a rejected DDSP removal without lying that the instrument was removed', async () => {
        mocks.registryState = {
            ...create_base_registry(),
            ddspInstruments: [
                {
                    ...DDSP_INSTRUMENT_CATALOG[0],
                    status: 'ready',
                    downloadProgress: 1,
                },
            ],
        };
        const failure = new Error('OPFS delete denied');
        use_case_mocks.removeDdspInstrument.mockRejectedValue(failure);
        const loggerError = vi.spyOn(logger, 'error').mockImplementation(() => undefined);

        render(<ModelManagerPanel />);
        fireEvent.click(screen.getByRole('button', { name: 'Remove Violin from storage' }));

        await vi.waitFor(() => expect(loggerError).toHaveBeenCalledTimes(1));
        const logged = loggerError.mock.calls[0]?.[0];
        expect(logged).toBeInstanceOf(Error);
        expect((logged as Error).cause).toBe(failure);
        loggerError.mockRestore();
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
            sha256: KOKORO_MODEL_ENTRY.sha256,
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
        expect(logged.message).toContain(`Failed to remove model "${KOKORO_MODEL_ENTRY.id}"`);
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
