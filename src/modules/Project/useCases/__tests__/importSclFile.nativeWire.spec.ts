import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDefaultProductionBrief } from '../../models/ProductionBrief';
import { type ProjectStoreState } from '../../stores/projectStore';
import { importSclFile } from '../importSclFile';

const mocks = vi.hoisted(() => ({
    invoke: vi.fn(),
    notifyUser: vi.fn(),
    pickFiles: vi.fn(),
    projectStore: { value: null as ProjectStoreState | null, set: vi.fn() },
    registerTuningTable: vi.fn(),
}));

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notifyUser }));
vi.mock('#/modules/AudioEngine/useCases', () => ({ registerTuningTable: mocks.registerTuningTable }));
vi.mock('../../stores/projectStore', () => ({ projectStore: mocks.projectStore }));
vi.mock('../fileDialog', () => ({ pickFiles: mocks.pickFiles }));

describe('importSclFile native wire', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.projectStore.value = {
            name: 'Session',
            createdAt: 1,
            updatedAt: 2,
            dirty: false,
            loading: false,
            keyRoot: 0,
            scaleName: 'chromatic',
            initialized: true,
            tuning: { name: 'Existing tuning', frequencies: [440] },
            productionBrief: createDefaultProductionBrief(1),
        };
    });

    it('shows the original line from the real decoder without changing prior tuning', async () => {
        const content = '! demo.scl\nDemo\n! count comment\n1\n3/0\n';
        const prior = structuredClone(mocks.projectStore.value);
        mocks.pickFiles.mockResolvedValue([new File([content], 'demo.scl')]);
        mocks.invoke.mockResolvedValue({
            error: { kind: 'zero-denominator', line: 5, reason: 'Zero denominator in ratio' },
        });
        vi.stubGlobal('sourdaw', { invoke: mocks.invoke });

        await importSclFile();

        expect(mocks.invoke).toHaveBeenCalledWith('parse_scl', [content, 69, 440]);
        expect(mocks.notifyUser).toHaveBeenCalledExactlyOnceWith(
            'Failed to import Scala file at line 5: Zero denominator in ratio',
            'error'
        );
        expect(mocks.projectStore.value).toEqual(prior);
        expect(mocks.projectStore.set).not.toHaveBeenCalled();
        expect(mocks.registerTuningTable).not.toHaveBeenCalled();
    });
});
