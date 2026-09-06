import { describe, it, expect, vi, beforeEach } from 'vitest';

import { pickFiles } from '#/modules/Project/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { setWorkspaceMode } from '../../../useCases/setWorkspaceMode';
import { handleImportMidiFile } from '../handleImportMidiFile';
import { handleSetWorkspaceMode } from '../handleSetWorkspaceMode';

vi.mock('../../../useCases/setWorkspaceMode', () => ({
    setWorkspaceMode: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    importMidiFile: vi.fn(),
}));

vi.mock('#/modules/Project/useCases', () => ({
    captureProjectTransitionAuthority: vi.fn(() => ({ isCurrent: () => true })),
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

    it('handleImportMidiFile notifies on file dialog failure', async () => {
        vi.mocked(pickFiles).mockRejectedValue(new Error('dialog'));

        void handleImportMidiFile.execute({ type: 'importMidiFile', payload: undefined });

        await vi.waitFor(() => {
            expect(notifyUser).toHaveBeenCalledWith('Failed to open file dialog', 'error');
        });
    });
});
