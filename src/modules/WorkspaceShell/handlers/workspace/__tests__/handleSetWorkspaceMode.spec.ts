import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getAutomationStoreState, removeAutomationPoint } from '#/modules/Automation/useCases';
import { pickFiles } from '#/modules/Project/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { setWorkspaceMode } from '../../../useCases/setWorkspaceMode';
import { handleImportMidiFile } from '../handleImportMidiFile';
import { handleRemoveAutomationPoint } from '../handleRemoveAutomationPoint';
import { handleSetWorkspaceMode } from '../handleSetWorkspaceMode';

vi.mock('../../../useCases/setWorkspaceMode', () => ({
    setWorkspaceMode: vi.fn(),
}));

vi.mock('#/modules/Automation/useCases', () => ({
    getAutomationStoreState: vi.fn(),
    removeAutomationPoint: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    importMidiFile: vi.fn(),
}));

vi.mock('#/modules/Project/useCases', () => ({
    pickFiles: vi.fn(),
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: vi.fn(),
}));

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
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 'track-1',
                    parameterId: 'volume',
                    parameterName: 'Volume',
                    points: [{ beat: 4, value: 0.5, curve: 'linear', tension: 0 }],
                    objects: [],
                    visible: true,
                    enabled: true,
                    collapsed: false,
                    minValue: 0,
                    maxValue: 1,
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
