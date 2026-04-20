import { describe, it, expect, vi, beforeEach } from 'vitest';

import { importAudioFile, importMidiFile, exportMidiClip } from '#/modules/Arrangement/useCases';
import { newProject, saveProject, exportProjectFile, pickFiles } from '#/modules/Project/useCases';

import { handleExportMidi } from '../handleExportMidi';
import { handleExportProject } from '../handleExportProject';
import { handleImportAudioFile } from '../handleImportAudioFile';
import { handleImportMidiFile } from '../handleImportMidiFile';
import { handleNewProject } from '../handleNewProject';
import { handleSaveProject } from '../handleSaveProject';

vi.mock('#/modules/Project/useCases', () => ({
    newProject: vi.fn(),
    saveProject: vi.fn(),
    exportProjectFile: vi.fn(),
    pickFiles: vi.fn().mockResolvedValue(['/mock/path.wav']),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    importAudioFile: vi.fn(),
    importMidiFile: vi.fn(),
    exportMidiClip: vi.fn(),
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: vi.fn(),
}));

describe('Workspace Project Handlers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('handleNewProject should delegate to newProject', () => {
        handleNewProject.execute({ type: 'newProject', payload: {} });
        expect(newProject).toHaveBeenCalled();
    });

    it('handleSaveProject should delegate to saveProject', () => {
        handleSaveProject.execute({ type: 'saveProject', payload: {} });
        expect(saveProject).toHaveBeenCalled();
    });

    it('handleImportAudioFile should pick files and import', async () => {
        await handleImportAudioFile.execute({ type: 'importAudioFile', payload: {} });
        expect(pickFiles).toHaveBeenCalledWith({
            filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'ogg', 'flac', 'aiff', 'aac'] }],
        });
        expect(importAudioFile).toHaveBeenCalledWith('/mock/path.wav');
    });

    it('handleImportMidiFile should pick files and import', async () => {
        vi.mocked(pickFiles).mockResolvedValueOnce(['/mock/path.mid']);
        await handleImportMidiFile.execute({ type: 'importMidiFile', payload: {} });
        expect(pickFiles).toHaveBeenCalledWith({ filters: [{ name: 'MIDI', extensions: ['mid', 'midi'] }] });
        expect(importMidiFile).toHaveBeenCalledWith('/mock/path.mid');
    });

    it('handleExportMidi should delegate to exportMidiClip', () => {
        handleExportMidi.execute({ type: 'exportMidi', payload: { clipId: 'c1' } });
        expect(exportMidiClip).toHaveBeenCalledWith('c1');
    });

    it('handleExportProject should delegate to exportProjectFile', () => {
        handleExportProject.execute({ type: 'exportProject', payload: {} });
        expect(exportProjectFile).toHaveBeenCalled();
    });
});
