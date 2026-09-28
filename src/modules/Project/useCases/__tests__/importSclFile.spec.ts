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

// The engine barrel stays mocked for one purpose: proving the import never
// forwards the table to the engine. No instrument consumes project tuning, so
// registering it there was the dead call #4675 removed.
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

    it('stores the imported scale on the project without forwarding it to the engine', async () => {
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
        // No instrument consumes the project tuning table, so there is nothing
        // to register with the engine — forwarding would be the dead call the
        // #4675 fix removed.
        expect(mocks.registerTuningTable).not.toHaveBeenCalled();
    });

    it('reports the stored scale and names no instrument as retuned', async () => {
        const sclContent = '! comment\nBright twelve\n1\n2/1\n';
        const selectedFile = new File([sclContent], 'bright.scl', {
            type: 'text/plain',
        });
        mocks.projectStore.value = createProjectState();
        mocks.pickFiles.mockResolvedValue([selectedFile]);
        mocks.parseScl.mockResolvedValue({
            name: 'Bright twelve',
            description: 'A test tuning',
            frequencies: [220, 440, 880],
        });

        await importSclFile();

        expect(mocks.notifyUser).toHaveBeenCalledTimes(1);
        const [message, severity] = mocks.notifyUser.mock.calls[0]!;
        // The notice claims only the real effect — storage — never a retune.
        expect(message).toContain('stored on the project');
        expect(message).toContain('no instrument');
        // It names no instrument: nothing honours the table.
        expect(message).not.toContain('Fermenter');
        expect(severity).toBe('success');
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
