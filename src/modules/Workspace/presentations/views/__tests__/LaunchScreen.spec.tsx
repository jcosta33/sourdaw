import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { LaunchScreen } from '../LaunchScreen';

const mocks = vi.hoisted(() => ({
    createFromTemplate: vi.fn(),
    executeAppAction: vi.fn(),
    getRecentProjects: vi.fn(() => []),
    getPreviewLoop: vi.fn(() => undefined),
    getTemplates: vi.fn(() => []),
    importDroppedLaunchFiles: vi.fn(),
    loadRecentProject: vi.fn(),
    newProject: vi.fn(),
    notifyUser: vi.fn(),
    pickAndImportDawProject: vi.fn(),
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: mocks.executeAppAction,
}));

vi.mock('#/modules/Project/useCases', () => ({
    createFromTemplate: mocks.createFromTemplate,
    getRecentProjects: mocks.getRecentProjects,
    getPreviewLoop: mocks.getPreviewLoop,
    getTemplates: mocks.getTemplates,
    loadRecentProject: mocks.loadRecentProject,
    newProject: mocks.newProject,
    pickAndImportDawProject: mocks.pickAndImportDawProject,
}));

vi.mock('../../../useCases/importDroppedLaunchFiles', () => ({
    importDroppedLaunchFiles: mocks.importDroppedLaunchFiles,
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: mocks.notifyUser,
}));

describe('LaunchScreen', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.createFromTemplate.mockResolvedValue(undefined);
        mocks.getRecentProjects.mockReturnValue([]);
        mocks.getTemplates.mockReturnValue([]);
        mocks.importDroppedLaunchFiles.mockResolvedValue({ status: 'completed', failedFileNames: [] });
        mocks.loadRecentProject.mockResolvedValue(true);
        mocks.newProject.mockResolvedValue(true);
        mocks.pickAndImportDawProject.mockResolvedValue(true);
    });

    it('should render the launch dialog with primary actions', () => {
        render(<LaunchScreen exiting={false} />);
        expect(screen.getByRole('dialog', { name: /Sourdaw — start a project/ })).toBeInTheDocument();
        expect(screen.getByText('Sourdaw')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /New Project/ })).toBeInTheDocument();
    });

    it('starts a new project in the click handler before shortcuts can run', () => {
        render(<LaunchScreen exiting={false} />);

        fireEvent.click(screen.getByRole('button', { name: /New Project/ }));

        expect(mocks.newProject).toHaveBeenCalledTimes(1);
    });

    it('restores the home view when direct new-project activation fails', async () => {
        mocks.newProject.mockResolvedValue(false);

        render(<LaunchScreen exiting={false} />);
        fireEvent.click(screen.getByRole('button', { name: /New Project/ }));

        await waitFor(() => {
            expect(mocks.notifyUser).toHaveBeenCalledWith('Failed to create a new project.', 'error');
            expect(screen.getByRole('button', { name: /New Project/ })).toBeInTheDocument();
        });
    });

    it('should dispatch a payloadless export action from the export click', () => {
        render(<LaunchScreen exiting={false} />);

        fireEvent.click(screen.getByRole('button', { name: /Export \.dawproject/ }));

        expect(mocks.executeAppAction).toHaveBeenCalledWith({ type: 'exportDawProject' });
    });

    it('opens the template grid and creates the selected template', async () => {
        mocks.getTemplates.mockReturnValue([
            { id: 'basic-band', name: 'Basic Band', description: 'A band', category: 'music' },
            { id: 'demo', name: 'Demo Session', description: 'A demo', category: 'demo' },
        ]);

        render(<LaunchScreen exiting={false} />);
        fireEvent.click(screen.getByRole('button', { name: /Templates/ }));

        expect(screen.getByRole('button', { name: /Basic Band/ })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /Basic Band/ }));

        await waitFor(() => expect(mocks.createFromTemplate).toHaveBeenCalledWith('basic-band'));
    });

    it('filters the demo grid to demo templates', () => {
        mocks.getTemplates.mockReturnValue([
            { id: 'basic-band', name: 'Basic Band', description: 'A band', category: 'music' },
            { id: 'demo', name: 'Demo Session', description: 'A demo', category: 'demo' },
        ]);

        render(<LaunchScreen exiting={false} />);
        fireEvent.click(screen.getByRole('button', { name: /Demos/ }));

        expect(screen.getByRole('button', { name: /Demo Session/ })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Basic Band/ })).not.toBeInTheDocument();
    });

    it('loads a selected recent project', async () => {
        mocks.getRecentProjects.mockReturnValue([{ key: 'recent-1', name: 'Recent Mix', updatedAt: Date.now() }]);

        render(<LaunchScreen exiting={false} />);
        fireEvent.click(screen.getByRole('button', { name: 'Open recent project Recent Mix' }));

        await waitFor(() => expect(mocks.loadRecentProject).toHaveBeenCalledWith('recent-1'));
    });

    it('imports a selected DAWproject', async () => {
        render(<LaunchScreen exiting={false} />);
        fireEvent.click(screen.getByRole('button', { name: /Import \.dawproject/ }));

        await waitFor(() => expect(mocks.pickAndImportDawProject).toHaveBeenCalledTimes(1));
    });

    it('dispatches dropped files and renders import failures', async () => {
        const midiFile = new File(['midi'], 'melody.mid', { type: 'audio/midi' });
        const audioFile = new File(['audio'], 'drums.wav', { type: 'audio/wav' });
        mocks.importDroppedLaunchFiles.mockResolvedValue({
            status: 'completed',
            failedFileNames: ['drums.wav'],
        });

        render(<LaunchScreen exiting={false} />);
        fireEvent.drop(screen.getByRole('dialog', { name: /Sourdaw — start a project/ }), {
            dataTransfer: { files: [midiFile, audioFile] },
        });

        await waitFor(() => {
            expect(mocks.importDroppedLaunchFiles).toHaveBeenCalledWith({ files: [midiFile, audioFile] });
            expect(mocks.notifyUser).toHaveBeenCalledWith('Failed to import "drums.wav"', 'error');
        });
    });

    it('restores the home view and reports an unsupported drop', async () => {
        const unsupportedFile = new File(['notes'], 'notes.txt', { type: 'text/plain' });
        mocks.importDroppedLaunchFiles.mockResolvedValue({ status: 'unsupported' });

        render(<LaunchScreen exiting={false} />);
        fireEvent.drop(screen.getByRole('dialog', { name: /Sourdaw — start a project/ }), {
            dataTransfer: { files: [unsupportedFile] },
        });

        await waitFor(() => {
            expect(mocks.notifyUser).toHaveBeenCalledWith('No supported audio or MIDI files were dropped.', 'warning');
            expect(screen.getByRole('button', { name: /New Project/ })).toBeInTheDocument();
        });
    });

    it('restores the home view when dropped-file project activation fails', async () => {
        const audioFile = new File(['audio'], 'drums.wav', { type: 'audio/wav' });
        mocks.importDroppedLaunchFiles.mockResolvedValue({ status: 'activation-failed' });

        render(<LaunchScreen exiting={false} />);
        fireEvent.drop(screen.getByRole('dialog', { name: /Sourdaw — start a project/ }), {
            dataTransfer: { files: [audioFile] },
        });

        await waitFor(() => {
            expect(mocks.notifyUser).toHaveBeenCalledWith('Failed to create a new project.', 'error');
            expect(screen.getByRole('button', { name: /New Project/ })).toBeInTheDocument();
        });
    });
});
