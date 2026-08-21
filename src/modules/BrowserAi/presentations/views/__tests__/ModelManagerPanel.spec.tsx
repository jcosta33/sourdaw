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

vi.mock('../../../useCases/downloadDdspInstrument', () => ({
    downloadDdspInstrument: use_case_mocks.downloadDdspInstrument,
}));

vi.mock('../../../useCases/downloadModel', () => ({
    downloadModel: use_case_mocks.downloadModel,
}));

vi.mock('../../../useCases/removeModel', () => ({
    removeModel: use_case_mocks.removeModel,
}));

vi.mock('../../../useCases/removeDdspInstrument', () => ({
    removeDdspInstrument: use_case_mocks.removeDdspInstrument,
}));

function create_registry_with_ddsp(
    statuses: Partial<
        Record<(typeof DDSP_INSTRUMENT_CATALOG)[number]['id'], ModelRegistryState['ddspInstruments'][number]['status']>
    > = {}
): ModelRegistryState {
    return {
        ddspInstruments: DDSP_INSTRUMENT_CATALOG.map((instrument) => ({
            ...instrument,
            status: statuses[instrument.id] ?? 'not-downloaded',
            downloadProgress: statuses[instrument.id] === 'ready' ? 1 : 0,
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

    it('shows exactly the four admitted catalog instruments with download actions from registry state', () => {
        mocks.registryState = create_registry_with_ddsp();

        render(<ModelManagerPanel />);

        expect(screen.getByText('DDSP Instruments')).toBeInTheDocument();
        expect(
            screen.getAllByRole('button', { name: /^Download (Violin|Flute|Trumpet|Tenor Saxophone) \(/ })
        ).toHaveLength(4);
        expect(screen.queryByText('Unavailable', { exact: true })).not.toBeInTheDocument();
        for (const instrument of DDSP_INSTRUMENT_CATALOG) {
            expect(screen.getByText(instrument.name, { exact: true })).toBeInTheDocument();
        }
    });

    it('delegates every DDSP download only to the pinned instrument use case', () => {
        mocks.registryState = create_registry_with_ddsp();
        render(<ModelManagerPanel />);

        for (const instrument of DDSP_INSTRUMENT_CATALOG) {
            fireEvent.click(screen.getByRole('button', { name: new RegExp(`^Download ${instrument.name} \\(`) }));
        }

        expect(use_case_mocks.downloadDdspInstrument.mock.calls).toEqual(
            DDSP_INSTRUMENT_CATALOG.map((instrument) => [instrument.id])
        );
        expect(use_case_mocks.downloadModel).not.toHaveBeenCalledWith(expect.objectContaining({ family: 'ddsp' }));
    });

    it('shows truthful checking state instead of fabricating readiness when registry entries are absent', () => {
        mocks.registryState = create_base_registry();

        render(<ModelManagerPanel />);

        expect(screen.getAllByText('Checking…', { exact: true })).toHaveLength(4);
        expect(screen.queryByRole('button', { name: /^Download (Violin|Flute|Trumpet|Tenor Saxophone)/ })).toBeNull();
    });

    it('shows DDSP progress, ready removal, and registry error retry states', () => {
        const registry = create_registry_with_ddsp({
            'ddsp-violin': 'downloading',
            'ddsp-flute': 'ready',
            'ddsp-trumpet': 'error',
        });
        registry.ddspInstruments[0] = { ...registry.ddspInstruments[0]!, downloadProgress: 0.42 };
        mocks.registryState = registry;

        render(<ModelManagerPanel />);

        expect(screen.getByRole('progressbar', { name: 'Downloading Violin: 42%' })).toHaveAttribute(
            'aria-valuenow',
            '42'
        );
        expect(screen.getByLabelText('Flute downloaded and ready')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Remove Flute from storage' }));
        fireEvent.click(screen.getByRole('button', { name: 'Retry downloading Trumpet' }));
        expect(use_case_mocks.removeDdspInstrument).toHaveBeenCalledExactlyOnceWith('ddsp-flute');
        expect(use_case_mocks.downloadDdspInstrument).toHaveBeenCalledExactlyOnceWith('ddsp-trumpet');
    });

    it('catches a DDSP action failure, makes it visible, and offers the exact retry', async () => {
        mocks.registryState = create_registry_with_ddsp();
        use_case_mocks.downloadDdspInstrument.mockRejectedValueOnce(new Error('network failed'));
        const loggerError = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
        render(<ModelManagerPanel />);

        fireEvent.click(screen.getByRole('button', { name: /^Download Violin \(/ }));

        expect(await screen.findByRole('alert', { name: 'Violin download failed' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Retry downloading Violin' }));
        await vi.waitFor(() => expect(use_case_mocks.downloadDdspInstrument).toHaveBeenCalledTimes(2));
        expect(loggerError).toHaveBeenCalledOnce();
        loggerError.mockRestore();
    });

    it('catches a DDSP removal failure and retries only the pinned removal use case', async () => {
        mocks.registryState = create_registry_with_ddsp({ 'ddsp-flute': 'ready' });
        use_case_mocks.removeDdspInstrument.mockRejectedValueOnce(new Error('OPFS denied'));
        const loggerError = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
        render(<ModelManagerPanel />);

        fireEvent.click(screen.getByRole('button', { name: 'Remove Flute from storage' }));

        expect(await screen.findByRole('alert', { name: 'Flute remove failed' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Retry removing Flute' }));
        await vi.waitFor(() => expect(use_case_mocks.removeDdspInstrument).toHaveBeenCalledTimes(2));
        expect(use_case_mocks.removeModel).not.toHaveBeenCalledWith(expect.objectContaining({ family: 'ddsp' }));
        expect(loggerError).toHaveBeenCalledOnce();
        loggerError.mockRestore();
    });

    it('keeps each DDSP action single-flight while its use case is pending', async () => {
        let finishDownload = (): void => undefined;
        use_case_mocks.downloadDdspInstrument.mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    finishDownload = resolve;
                })
        );
        mocks.registryState = create_registry_with_ddsp();
        render(<ModelManagerPanel />);
        const button = screen.getByRole('button', { name: /^Download Violin \(/ });

        fireEvent.click(button);
        fireEvent.click(button);

        expect(use_case_mocks.downloadDdspInstrument).toHaveBeenCalledExactlyOnceWith('ddsp-violin');
        expect(screen.getByRole('progressbar', { name: 'Downloading Violin: 0%' })).toBeInTheDocument();
        finishDownload();
        await vi.waitFor(() => expect(screen.getByRole('button', { name: /^Download Violin \(/ })).toBeEnabled());
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
