import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { pickFiles } from '#/modules/Project/useCases';

import { persistGrinderNeuralLibrary } from '../../repositories/neuralLibraryPersistence/persistGrinderNeuralLibrary';
import {
    DEFAULT_GRINDER_NEURAL_LIBRARY_STATE,
    grinderNeuralLibraryStore,
} from '../../stores/grinderNeuralLibraryStore';
import { importGrinderNeuralModels } from '../importGrinderNeuralModels';

vi.mock('#/modules/Project/useCases', () => ({
    pickFiles: vi.fn(),
}));

vi.mock('../../repositories/neuralLibraryPersistence/persistGrinderNeuralLibrary', () => ({
    persistGrinderNeuralLibrary: vi.fn(),
}));

const pick_files_mock = vi.mocked(pickFiles);
const persist_library_mock = vi.mocked(persistGrinderNeuralLibrary);

function make_nam_file(input: { file_name: string; display_name: string }): File {
    return new File(
        [
            JSON.stringify({
                architecture: 'WaveNet',
                config: { sample_rate: 48_000 },
                weights: [0.14, -0.21, 0.32, 0.08, -0.11, 0.27],
                metadata: { name: input.display_name },
            }),
        ],
        input.file_name
    );
}

describe('importGrinderNeuralModels', () => {
    beforeEach(() => {
        grinderNeuralLibraryStore.set(DEFAULT_GRINDER_NEURAL_LIBRARY_STATE);
        pick_files_mock.mockReset();
        persist_library_mock.mockReset();
        persist_library_mock.mockResolvedValue({ ok: true });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should open the Project picker with Grinder neural filters and import parseable selected files', async () => {
        vi.spyOn(Date, 'now').mockReturnValue(1_725_000_000_000);
        pick_files_mock.mockResolvedValue([
            make_nam_file({ file_name: 'tight-rhythm.nam', display_name: 'Tight Rhythm' }),
        ]);

        const imported_entries = await importGrinderNeuralModels();

        expect(pickFiles).toHaveBeenCalledExactlyOnceWith({
            multiple: true,
            filters: [{ name: 'Neural captures', extensions: ['nam', 'json'] }],
        });
        expect(imported_entries).toHaveLength(1);
        expect(imported_entries[0]?.sourceFileName).toBe('tight-rhythm.nam');
        expect(imported_entries[0]?.name).toBe('Tight Rhythm');
        expect(grinderNeuralLibraryStore.value?.entries.map((entry) => entry.sourceFileName)).toEqual([
            'tight-rhythm.nam',
        ]);
        expect(persistGrinderNeuralLibrary).toHaveBeenCalledExactlyOnceWith({
            entries: [expect.objectContaining({ sourceFileName: 'tight-rhythm.nam' })],
        });
    });

    it('should return no imports without persisting when the picker is cancelled', async () => {
        pick_files_mock.mockResolvedValue(null);

        const imported_entries = await importGrinderNeuralModels();

        expect(imported_entries).toEqual([]);
        expect(persistGrinderNeuralLibrary).not.toHaveBeenCalled();
        expect(grinderNeuralLibraryStore.value).toEqual({
            ...DEFAULT_GRINDER_NEURAL_LIBRARY_STATE,
            loading: false,
        });
    });

    it('should return no imports without persisting when the picker selection is empty', async () => {
        pick_files_mock.mockResolvedValue([]);

        const imported_entries = await importGrinderNeuralModels();

        expect(imported_entries).toEqual([]);
        expect(persistGrinderNeuralLibrary).not.toHaveBeenCalled();
        expect(grinderNeuralLibraryStore.value).toEqual({
            ...DEFAULT_GRINDER_NEURAL_LIBRARY_STATE,
            loading: false,
        });
    });
});
