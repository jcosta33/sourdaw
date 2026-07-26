import { describe, it, expect, vi, beforeEach } from 'vitest';

import { importAudioFile, importMidiFile } from '#/modules/Arrangement/useCases';
import { newProject, saveProject, exportProjectFile, pickFiles } from '#/modules/Project/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { handleExportProject } from '../handleExportProject';
import { handleImportAudioFile } from '../handleImportAudioFile';
import { handleImportMidiFile } from '../handleImportMidiFile';
import { handleNewProject } from '../handleNewProject';
import { handleSaveProject } from '../handleSaveProject';

const pickedFiles = vi.hoisted(() => ({
    audio: new File([], 'path.wav'),
    midi: new File([], 'path.mid'),
}));

vi.mock('#/modules/Project/useCases', () => ({
    newProject: vi.fn(),
    saveProject: vi.fn(),
    exportProjectFile: vi.fn(),
    pickFiles: vi.fn().mockResolvedValue([pickedFiles.audio]),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    importAudioFile: vi.fn(),
    importMidiFile: vi.fn(),
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: vi.fn(),
}));

describe('Workspace Project Handlers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('handleNewProject should delegate to newProject', () => {
        void handleNewProject.execute({ type: 'newProject' });
        expect(newProject).toHaveBeenCalled();
    });

    it('handleSaveProject should delegate to saveProject', () => {
        void handleSaveProject.execute({ type: 'saveProject' });
        expect(saveProject).toHaveBeenCalled();
    });

    it('handleImportAudioFile should pick files and import', async () => {
        await handleImportAudioFile.execute({ type: 'importAudioFile' });
        expect(pickFiles).toHaveBeenCalledWith({
            filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'ogg', 'flac', 'aiff', 'aac'] }],
        });
        expect(importAudioFile).toHaveBeenCalledWith(pickedFiles.audio);
    });

    it('handleImportMidiFile should pick files and import', async () => {
        vi.mocked(pickFiles).mockResolvedValueOnce([pickedFiles.midi]);
        await handleImportMidiFile.execute({ type: 'importMidiFile' });
        expect(pickFiles).toHaveBeenCalledWith({ filters: [{ name: 'MIDI', extensions: ['mid', 'midi'] }] });
        expect(importMidiFile).toHaveBeenCalledWith(pickedFiles.midi);
    });

    it('handleExportProject should delegate to exportProjectFile', () => {
        void handleExportProject.execute({ type: 'exportProject' });
        expect(exportProjectFile).toHaveBeenCalled();
    });

    it('handleImportAudioFile does not import when the file dialog is cancelled (null)', async () => {
        vi.mocked(pickFiles).mockResolvedValueOnce(null);
        await handleImportAudioFile.execute({ type: 'importAudioFile' });
        // No import attempted when pickFiles returns null.
        expect(importAudioFile).not.toHaveBeenCalled();
    });

    it('handleImportAudioFile imports every picked file when multiple are returned', async () => {
        const a = new File([], 'a.wav');
        const b = new File([], 'b.wav');
        vi.mocked(pickFiles).mockResolvedValueOnce([a, b]);
        await handleImportAudioFile.execute({ type: 'importAudioFile' });
        expect(importAudioFile).toHaveBeenCalledTimes(2);
        expect(importAudioFile).toHaveBeenNthCalledWith(1, a);
        expect(importAudioFile).toHaveBeenNthCalledWith(2, b);
    });

    it('handleImportAudioFile notifies on error when the dialog rejects', async () => {
        vi.mocked(pickFiles).mockRejectedValueOnce(new Error('dialog closed'));
        // execute() does not await the promise chain — flush microtasks.
        handleImportAudioFile.execute({ type: 'importAudioFile' });
        await vi.waitFor(() => {
            expect(notifyUser).toHaveBeenCalledWith('Failed to open file dialog', 'error');
        });
        expect(importAudioFile).not.toHaveBeenCalled();
    });

    it('handleImportMidiFile does not import when the file dialog is cancelled (null)', async () => {
        vi.mocked(pickFiles).mockResolvedValueOnce(null);
        await handleImportMidiFile.execute({ type: 'importMidiFile' });
        expect(importMidiFile).not.toHaveBeenCalled();
    });

    it('handleImportMidiFile notifies on error when the dialog rejects', async () => {
        vi.mocked(pickFiles).mockRejectedValueOnce(new Error('dialog closed'));
        handleImportMidiFile.execute({ type: 'importMidiFile' });
        await vi.waitFor(() => {
            expect(notifyUser).toHaveBeenCalledWith('Failed to open file dialog', 'error');
        });
        expect(importMidiFile).not.toHaveBeenCalled();
    });
});
