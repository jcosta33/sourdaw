import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDefaultProductionBrief } from '../../models/ProductionBrief';
import { type ProjectStoreState } from '../../stores/projectStore';
import { importSclFile } from '../importSclFile';

type ParseSclResult = {
    name: string;
    description: string;
    frequencies: number[];
};

const mocks = vi.hoisted(() => {
    let projectValue: ProjectStoreState | null = null;

    return {
        notifyUser: vi.fn<(message: string, type: 'success' | 'error') => void>(),
        parseScl: vi.fn<(content: string) => Promise<ParseSclResult>>(),
        pickFiles: vi.fn<() => Promise<File[] | null>>(),
        projectStore: {
            get value(): ProjectStoreState | null {
                return projectValue;
            },
            set value(nextValue: ProjectStoreState | null) {
                projectValue = nextValue;
            },
            set: vi.fn<(nextValue: ProjectStoreState) => void>(),
        },
        registerTuningTable: vi.fn<(frequencies: number[]) => void>(),
    };
});

vi.mock('#/modules/AudioEngine/useCases', () => ({
    registerTuningTable: mocks.registerTuningTable,
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: mocks.notifyUser,
}));

vi.mock('../../repositories/nativeTuning/parseScl', () => ({
    parseScl: mocks.parseScl,
}));

vi.mock('../../stores/projectStore', () => ({
    projectStore: mocks.projectStore,
}));

vi.mock('../fileDialog', () => ({
    pickFiles: mocks.pickFiles,
}));

function createProjectState(): ProjectStoreState {
    return {
        name: 'Session',
        createdAt: 1,
        updatedAt: 2,
        dirty: false,
        loading: false,
        keyRoot: 0,
        scaleName: 'chromatic',
        tuning: {
            name: 'Equal Temperament',
            frequencies: [440],
        },
        initialized: true,
        productionBrief: createDefaultProductionBrief(1),
    };
}

describe('importSclFile', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.projectStore.value = null;
    });

    it('should import the selected Scala file into project tuning and engine tuning', async () => {
        const initialProject = createProjectState();
        const sclContent = '! comment\nBright twelve\n1\n2/1\n';
        const frequencies = [220, 440, 880];
        const selectedFile = new File([sclContent], 'bright.scl', {
            type: 'text/plain',
        });
        mocks.projectStore.value = initialProject;
        mocks.pickFiles.mockResolvedValue([selectedFile]);
        mocks.parseScl.mockResolvedValue({
            name: 'Bright twelve',
            description: 'A test tuning',
            frequencies,
        });

        await importSclFile();

        expect(mocks.pickFiles).toHaveBeenCalledWith({
            multiple: false,
            filters: [{ name: 'Scala', extensions: ['scl'] }],
        });
        expect(mocks.parseScl).toHaveBeenCalledWith(sclContent);
        expect(mocks.projectStore.set).toHaveBeenCalledWith({
            ...initialProject,
            tuning: {
                name: 'Bright twelve',
                frequencies,
            },
        });
        expect(mocks.registerTuningTable).toHaveBeenCalledWith(frequencies);
        expect(mocks.notifyUser).toHaveBeenCalledWith('Imported scale: Bright twelve', 'success');
    });

    it('should not parse or notify when no file is selected', async () => {
        mocks.pickFiles.mockResolvedValue(null);

        await importSclFile();

        expect(mocks.parseScl).not.toHaveBeenCalled();
        expect(mocks.projectStore.set).not.toHaveBeenCalled();
        expect(mocks.registerTuningTable).not.toHaveBeenCalled();
        expect(mocks.notifyUser).not.toHaveBeenCalled();
    });
});
