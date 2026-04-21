import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleSetWorkspaceMode } from '../handleSetWorkspaceMode';

vi.mock('../../../useCases/setWorkspaceMode', () => ({
    setWorkspaceMode: vi.fn(),
}));

vi.mock('#/modules/Automation/useCases/getAutomationStoreState', () => ({
    getAutomationStoreState: vi.fn(),
}));
vi.mock('#/modules/Automation/useCases/automation/removeAutomationPoint', () => ({
    removeAutomationPoint: vi.fn(),
}));

vi.mock('#/modules/Arrangement', () => ({
    importMidiFile: vi.fn(),
}));

vi.mock('#/modules/Project/repositories/nativeFileDialog/pickFiles', () => ({
    pickFiles: vi.fn(),
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: vi.fn(),
}));

import { removeAutomationPoint } from '#/modules/Automation/useCases/automation/removeAutomationPoint';
import { getAutomationStoreState } from '#/modules/Automation/useCases/getAutomationStoreState';
import { pickFiles } from '#/modules/Project/repositories/nativeFileDialog/pickFiles';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { setWorkspaceMode } from '../../../useCases/setWorkspaceMode';
import { handleImportMidiFile } from '../handleImportMidiFile';
import { handleRemoveAutomationPoint } from '../handleRemoveAutomationPoint';

describe('workspace handlers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('handleSetWorkspaceMode forwards mode', () => {
        void handleSetWorkspaceMode.execute({
            type: 'setWorkspaceMode',
            payload: { mode: 'arrange' },
        });

        expect(setWorkspaceMode).toHaveBeenCalledWith('arrange');
    });

    it('handleRemoveAutomationPoint removes by lane and point index', () => {
        vi.mocked(getAutomationStoreState).mockReturnValue({
            // @ts-expect-error — partial AutomationStoreState for test
            lanes: [
                {
                    id: 'lane-1',
                    points: [{ beat: 4, value: 0.5, curve: 'linear' as const, tension: 0 }],
                },
            ],
        });

        void handleRemoveAutomationPoint.execute({
            type: 'removeAutomationPoint',
            payload: { laneId: 'lane-1', pointIndex: 0 },
        });

        expect(removeAutomationPoint).toHaveBeenCalledWith('lane-1', 4);
    });

    it('handleImportMidiFile notifies on file dialog failure', async () => {
        vi.mocked(pickFiles).mockRejectedValue(new Error('dialog'));

        void handleImportMidiFile.execute({ type: 'importMidiFile', payload: undefined });

        await vi.waitFor(() => {
            expect(notifyUser).toHaveBeenCalledWith('Failed to open file dialog', 'error');
        });
    });
});
