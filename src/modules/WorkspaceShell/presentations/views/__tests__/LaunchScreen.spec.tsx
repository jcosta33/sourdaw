import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { LaunchScreen } from '../LaunchScreen';

type TemplateFixture = { id: string; name: string; description: string; category: string };
type RecentProjectFixture = { key: string; name: string; updatedAt: number };
const mocks = vi.hoisted(() => ({
    createFromTemplate: vi.fn(),
    executeAppAction: vi.fn(),
    getRecentProjects: vi.fn((): RecentProjectFixture[] => []),
    getPreviewLoop: vi.fn(() => undefined),
    getTemplates: vi.fn((): TemplateFixture[] => []),
    importDroppedLaunchFiles: vi.fn(),
    loadRecentProject: vi.fn(),
    newProject: vi.fn(),
    notifyUser: vi.fn(),
    pickAndImportDawProject: vi.fn(),
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: mocks.executeAppAction,
}));

vi.mock('#/modules/DawInterchange/useCases', () => ({
    pickAndImportDawProject: mocks.pickAndImportDawProject,
}));

vi.mock('#/modules/Project/useCases', () => ({
    createFromTemplate: mocks.createFromTemplate,
    getRecentProjects: mocks.getRecentProjects,
    getPreviewLoop: mocks.getPreviewLoop,
    getTemplates: mocks.getTemplates,
    loadRecentProject: mocks.loadRecentProject,
    newProject: mocks.newProject,
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
        mocks.createFromTemplate.mockResolvedValue(true);
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

    it('restores the home view when template project activation fails', async () => {
        mocks.createFromTemplate.mockResolvedValue(false);
        mocks.getTemplates.mockReturnValue([
            { id: 'empty', name: 'Empty Project', description: 'A blank canvas', category: 'empty' },
        ]);

        render(<LaunchScreen exiting={false} />);
        fireEvent.click(screen.getByRole('button', { name: /Templates/ }));
        fireEvent.click(screen.getByRole('button', { name: /Empty Project/ }));

        await waitFor(() => {
            expect(mocks.notifyUser).toHaveBeenCalledWith('Failed to create a new project.', 'error');
            expect(screen.getByRole('button', { name: /New Project/ })).toBeInTheDocument();
        });
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

    // `pickAndImportDawProject` covers both the file picker and the import and only
    // resolves when both are done. Before this, the slowest action on the launch
    // screen reported nothing and stayed clickable for its whole duration.
    it('marks the import button busy and refuses re-entry while an import is running', async () => {
        let settleImport = (_ok: boolean): void => {};
        mocks.pickAndImportDawProject.mockReturnValue(
            new Promise<boolean>((resolve) => {
                settleImport = resolve;
            })
        );
        render(<LaunchScreen exiting={false} />);

        const button = screen.getByRole('button', { name: /Import \.dawproject/ });
        button.focus();
        expect(button).toHaveFocus();

        fireEvent.click(button);

        const busyButton = await screen.findByRole('button', { name: /Importing \.dawproject/ });
        // `disabled` would blur this to <body> the instant the handler ran, so a
        // keyboard user would have to Tab from the top of the launch screen after
        // a picker that can stay up for minutes. `aria-disabled` keeps the element
        // focusable and reachable, and re-entry is blocked by the handler's guard.
        expect(busyButton).toHaveFocus();
        expect(busyButton).not.toBeDisabled();
        expect(busyButton).toHaveAttribute('aria-disabled', 'true');
        expect(busyButton).toHaveAttribute('aria-busy', 'true');

        // A second click while in flight must not start a second import.
        fireEvent.click(busyButton);
        expect(mocks.pickAndImportDawProject).toHaveBeenCalledTimes(1);

        await act(async () => {
            settleImport(false);
        });

        await waitFor(() => {
            expect(screen.getByRole('button', { name: /Import \.dawproject/ })).toHaveAttribute(
                'aria-disabled',
                'false'
            );
        });
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

    it('leaves a superseded drop to the newer project transition', async () => {
        const audioFile = new File(['audio'], 'slow.wav', { type: 'audio/wav' });
        mocks.importDroppedLaunchFiles.mockResolvedValue({ status: 'superseded' });

        render(<LaunchScreen exiting={false} />);
        fireEvent.drop(screen.getByRole('dialog', { name: /Sourdaw — start a project/ }), {
            dataTransfer: { files: [audioFile] },
        });

        await waitFor(() => expect(mocks.importDroppedLaunchFiles).toHaveBeenCalledWith({ files: [audioFile] }));
        expect(mocks.notifyUser).not.toHaveBeenCalled();
    });

    // ── Import / recent failure paths ─────────────────────────────────────────────

    it('does not enter the loading view when the DAWproject import is cancelled', async () => {
        mocks.pickAndImportDawProject.mockResolvedValue(false);
        render(<LaunchScreen exiting={false} />);
        fireEvent.click(screen.getByRole('button', { name: /Import \.dawproject/ }));

        await waitFor(() => expect(mocks.pickAndImportDawProject).toHaveBeenCalledTimes(1));
        // Stays on home (New Project button still present), no loading name set.
        expect(screen.getByRole('button', { name: /New Project/ })).toBeInTheDocument();
    });

    it('refreshes the recent-projects list and restores home when a recent project fails to load', async () => {
        const refreshed = [{ key: 'r2', name: 'Newer Mix', updatedAt: Date.now() }];
        mocks.getRecentProjects
            .mockReturnValueOnce([{ key: 'recent-1', name: 'Recent Mix', updatedAt: Date.now() }])
            .mockReturnValueOnce(refreshed);
        mocks.loadRecentProject.mockResolvedValue('failed');

        render(<LaunchScreen exiting={false} />);
        fireEvent.click(screen.getByRole('button', { name: 'Open recent project Recent Mix' }));

        await waitFor(() => {
            expect(mocks.notifyUser).toHaveBeenCalledWith('Failed to open "Recent Mix"', 'error');
            expect(screen.getByRole('button', { name: /New Project/ })).toBeInTheDocument();
        });
    });

    // ── Category filtering ────────────────────────────────────────────────────────

    it('switches the active category in the grid and filters the template list', () => {
        mocks.getTemplates.mockReturnValue([
            { id: 'basic-band', name: 'Basic Band', description: 'A band', category: 'music' },
            { id: 'podcast-1', name: 'Podcast One', description: 'A podcast', category: 'podcast' },
        ]);

        render(<LaunchScreen exiting={false} />);
        fireEvent.click(screen.getByRole('button', { name: /Templates/ }));

        // Both visible under "All"
        expect(screen.getByRole('button', { name: /Basic Band/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Podcast One/ })).toBeInTheDocument();

        // Switch to Podcast category
        fireEvent.click(screen.getByRole('button', { name: /^Podcast$/ }));
        expect(screen.queryByRole('button', { name: /Basic Band/ })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Podcast One/ })).toBeInTheDocument();
    });

    it('navigates back from the grid to home', () => {
        mocks.getTemplates.mockReturnValue([
            { id: 'basic-band', name: 'Basic Band', description: 'A band', category: 'music' },
        ]);
        render(<LaunchScreen exiting={false} />);
        fireEvent.click(screen.getByRole('button', { name: /Templates/ }));
        expect(screen.getByRole('button', { name: /Basic Band/ })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /Back to home/ }));
        expect(screen.queryByRole('button', { name: /Basic Band/ })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /New Project/ })).toBeInTheDocument();
    });

    // ── Drag-and-drop visual feedback ─────────────────────────────────────────────

    it('toggles the drag-over state on dragOver and clears it on dragLeave', () => {
        render(<LaunchScreen exiting={false} />);
        const dialog = screen.getByRole('dialog', { name: /Sourdaw — start a project/ });

        // dragOver sets isDragOver=true, swapping the drop zone to the orange style.
        fireEvent.dragOver(dialog, { dataTransfer: { dropEffect: 'none' } });
        const dropZone = screen.getByText('Drop audio or MIDI to start instantly').parentElement!;
        expect(dropZone.className).toContain('--color-accent-orange');

        // dragLeave with a relatedTarget outside the dialog clears the state.
        fireEvent.dragLeave(dialog, { relatedTarget: document.body });
        expect(dropZone.className).not.toContain('bg-[var(--color-accent-orange)]/10');
    });

    it('formats recent-project timestamps as relative time (just now / Xm ago / Xh ago / Xd ago)', () => {
        const now = Date.now();
        mocks.getRecentProjects.mockReturnValue([
            { key: 'r1', name: 'Just Now', updatedAt: now - 5_000 },
            { key: 'r2', name: 'Minutes Ago', updatedAt: now - 5 * 60_000 },
            { key: 'r3', name: 'Hours Ago', updatedAt: now - 3 * 3_600_000 },
            { key: 'r4', name: 'Days Ago', updatedAt: now - 3 * 86_400_000 },
        ]);

        render(<LaunchScreen exiting={false} />);
        expect(screen.getByText('just now')).toBeInTheDocument();
        expect(screen.getByText('5m ago')).toBeInTheDocument();
        expect(screen.getByText('3h ago')).toBeInTheDocument();
        expect(screen.getByText('3d ago')).toBeInTheDocument();
    });

    it('hides the recent-projects section when there are no recent projects', () => {
        mocks.getRecentProjects.mockReturnValue([]);
        render(<LaunchScreen exiting={false} />);
        expect(screen.queryByRole('list', { name: /Recent projects/ })).not.toBeInTheDocument();
    });
});
