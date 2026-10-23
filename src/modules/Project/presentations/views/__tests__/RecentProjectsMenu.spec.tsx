import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { notifyUser } from '#/utils/Notification/notifyUser';

import { newProject } from '../../../useCases/projectPersistence/newProject';
import { saveProject } from '../../../useCases/projectPersistence/saveProject/saveProject';
import { loadRecentProject } from '../../../useCases/recentProjects/loadRecentProject';
import { removeFromRecentProjects } from '../../../useCases/recentProjects/removeFromRecentProjects';
import { RecentProjectsMenu } from '../RecentProjectsMenu';

const mocks = vi.hoisted(() => ({
    projectStoreValue: { value: null as { dirty: boolean; createdAt?: number } | null },
}));

vi.mock('../../../stores/projectStore', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../stores/projectStore')>()),
    projectStore: {
        get value() {
            return mocks.projectStoreValue.value;
        },
        set: vi.fn(),
    },
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: vi.fn(),
}));

vi.mock('../../../useCases/recentProjects/loadRecentProject', () => ({
    loadRecentProject: vi.fn(),
}));

vi.mock('../../../useCases/recentProjects/removeFromRecentProjects', () => ({
    removeFromRecentProjects: vi.fn(),
}));

vi.mock('../../../useCases/recentProjects/helpers', () => ({
    getRecentProjects: vi.fn(() => [
        { key: 'proj-1', name: 'Project One', updatedAt: Date.now() - 100000 },
        { key: 'proj-2', name: 'Project Two', updatedAt: Date.now() - 200000 },
        { key: 'sourdaw:project:1700000000000', name: 'Open Project', updatedAt: Date.now() - 300000 },
    ]),
}));

vi.mock('../../../useCases/projectPersistence/newProject', () => ({
    newProject: vi.fn(),
}));

vi.mock('../../../useCases/projectPersistence/saveProject/saveProject', () => ({
    saveProject: vi.fn(),
}));

vi.mock('../../../useCases/projectPersistence/fileIO/pickAndImportProjectFile', () => ({
    pickAndImportProjectFile: vi.fn(),
}));

vi.mock('../../../useCases/projectPersistence/fileIO/exportProjectFile', () => ({
    exportProjectFile: vi.fn(),
}));

vi.mock('#/modules/WorkspaceShell/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/WorkspaceShell/useCases')>()),
    openExportDialog: vi.fn(),
}));

// Mock UI components
vi.mock('#/components/daw/DawKeycap', () => ({
    DawKeycap: ({ children }: { children: React.ReactNode }) => <kbd data-testid="keycap">{children}</kbd>,
}));

vi.mock('#/components/ui/button', () => ({
    Button: ({
        children,
        variant,
        size,
        asChild: _asChild,
        ...props
    }: React.ComponentProps<'button'> & { variant?: string; size?: string; asChild?: boolean }) => (
        <button type="button" data-variant={variant} data-size={size} {...props}>
            {children}
        </button>
    ),
}));

vi.mock('#/components/ui/tooltip', () => ({
    Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    TooltipContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../TemplateChooser', () => ({
    TemplateChooser: ({ open }: { open: boolean }) =>
        open ? <div data-testid="template-chooser">Template Chooser</div> : null,
}));

describe('RecentProjectsMenu', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.projectStoreValue.value = null;
    });

    it('should render without crashing', () => {
        render(<RecentProjectsMenu />);
        expect(screen.getByLabelText(/Project menu/i)).toBeInTheDocument();
    });

    it('renders as the right segment of the project control', () => {
        render(<RecentProjectsMenu />);

        const trigger = screen.getByLabelText(/Project menu/i);

        expect(trigger).toHaveClass(
            'daw-readout-well',
            'rounded-l-none',
            'rounded-r-sm',
            'border-l-[rgba(255,249,242,0.1)]',
            'hover:brightness-[1.06]'
        );
        expect(trigger).toHaveAttribute('data-size', 'icon-sm');
        expect(trigger).toContainElement(screen.getByTestId('project-menu-chevron'));
    });

    it('should show menu when button is clicked', () => {
        render(<RecentProjectsMenu />);
        const button = screen.getByLabelText(/Project menu/i);
        fireEvent.click(button);
        expect(screen.getByRole('menu')).toBeInTheDocument();
    });

    it('keeps the project menu scrollable within the renderer height', () => {
        render(<RecentProjectsMenu />);
        fireEvent.click(screen.getByLabelText(/Project menu/i));

        expect(screen.getByRole('menu')).toHaveClass(
            'max-h-[calc(100vh-3rem)]',
            'overflow-y-auto',
            'overscroll-contain'
        );
    });

    it('left-aligns menu rows that do not carry a trailing shortcut', () => {
        render(<RecentProjectsMenu />);
        fireEvent.click(screen.getByLabelText(/Project menu/i));

        const labels = [
            'New Project',
            'New from Template…',
            'Load Demo Project…',
            'Export Project File…',
            'Import Project File…',
        ];
        for (const label of labels) {
            expect(screen.getByRole('menuitem', { name: label })).toHaveClass('justify-start');
        }
    });

    it('should render New Project option', () => {
        render(<RecentProjectsMenu />);
        const button = screen.getByLabelText(/Project menu/i);
        fireEvent.click(button);
        expect(screen.getByText(/New Project/i)).toBeInTheDocument();
    });

    it('should render New from Template option', () => {
        render(<RecentProjectsMenu />);
        const button = screen.getByLabelText(/Project menu/i);
        fireEvent.click(button);
        expect(screen.getByText(/New from Template/i)).toBeInTheDocument();
    });

    it('should render Load Demo Project option', () => {
        render(<RecentProjectsMenu />);
        const button = screen.getByLabelText(/Project menu/i);
        fireEvent.click(button);
        expect(screen.getByText(/Load Demo Project/i)).toBeInTheDocument();
    });

    it('should render Save option', () => {
        render(<RecentProjectsMenu />);
        const button = screen.getByLabelText(/Project menu/i);
        fireEvent.click(button);
        expect(screen.getByText(/Save/i)).toBeInTheDocument();
    });

    it('should render Export Audio option', () => {
        render(<RecentProjectsMenu />);
        const button = screen.getByLabelText(/Project menu/i);
        fireEvent.click(button);
        expect(screen.getByText(/Export Audio/i)).toBeInTheDocument();
    });

    it('should render Export Project File option', () => {
        render(<RecentProjectsMenu />);
        const button = screen.getByLabelText(/Project menu/i);
        fireEvent.click(button);
        expect(screen.getByText(/Export Project File/i)).toBeInTheDocument();
    });

    it('should render Import Project File option', () => {
        render(<RecentProjectsMenu />);
        const button = screen.getByLabelText(/Project menu/i);
        fireEvent.click(button);
        expect(screen.getByText(/Import Project File/i)).toBeInTheDocument();
    });

    it('should display recent projects section', () => {
        render(<RecentProjectsMenu />);
        const button = screen.getByLabelText(/Project menu/i);
        fireEvent.click(button);
        expect(screen.getByText(/Recent/i)).toBeInTheDocument();
        expect(screen.getByText('Project One')).toBeInTheDocument();
        expect(screen.getByText('Project Two')).toBeInTheDocument();
    });

    it('should show keyboard shortcut for Save', () => {
        render(<RecentProjectsMenu />);
        const button = screen.getByLabelText(/Project menu/i);
        fireEvent.click(button);
        const keycaps = screen.getAllByTestId('keycap');
        expect(keycaps.length).toBeGreaterThan(0);
    });

    it('awaits the pre-switch save before starting a new project', async () => {
        let resolveSave: ((value: boolean) => void) | undefined;
        vi.mocked(saveProject).mockImplementation(
            () =>
                new Promise<boolean>((resolve) => {
                    resolveSave = resolve;
                })
        );
        vi.mocked(newProject).mockResolvedValue(true);

        render(<RecentProjectsMenu />);
        fireEvent.click(screen.getByLabelText(/Project menu/i));
        fireEvent.click(screen.getByRole('menuitem', { name: /New Project/i }));

        await waitFor(() => expect(saveProject).toHaveBeenCalledOnce());
        expect(newProject).not.toHaveBeenCalled();

        resolveSave?.(true);
        await waitFor(() => expect(newProject).toHaveBeenCalledOnce());
    });

    it('aborts the new-project transition when the pre-switch save fails', async () => {
        vi.mocked(saveProject).mockResolvedValue(false);
        vi.mocked(newProject).mockResolvedValue(true);

        render(<RecentProjectsMenu />);
        fireEvent.click(screen.getByLabelText(/Project menu/i));
        fireEvent.click(screen.getByRole('menuitem', { name: /New Project/i }));

        await waitFor(() => expect(saveProject).toHaveBeenCalledOnce());
        // Flush the aborted continuation (microtasks only — no timers).
        await Promise.resolve();
        await Promise.resolve();
        expect(newProject).not.toHaveBeenCalled();
        expect(notifyUser).not.toHaveBeenCalled();
    });

    // Issue 3694: a save can resolve true while the project is still dirty —
    // a plugin state capture rejected before commit warns and keeps that edit
    // out of project truth. Replacing the project over it would destroy the
    // edit, so the transition must refuse even though the save resolved.
    it('refuses the new-project transition when the save resolved but left the project dirty', async () => {
        mocks.projectStoreValue.value = { dirty: true };
        vi.mocked(saveProject).mockResolvedValue(true);
        vi.mocked(newProject).mockResolvedValue(true);

        render(<RecentProjectsMenu />);
        fireEvent.click(screen.getByLabelText(/Project menu/i));
        fireEvent.click(screen.getByRole('menuitem', { name: /New Project/i }));

        await waitFor(() => expect(saveProject).toHaveBeenCalledOnce());
        await Promise.resolve();
        await Promise.resolve();
        expect(newProject).not.toHaveBeenCalled();
    });

    it('refuses the recent-project load when the save resolved but left the project dirty', async () => {
        mocks.projectStoreValue.value = { dirty: true };
        vi.mocked(saveProject).mockResolvedValue(true);

        render(<RecentProjectsMenu />);
        fireEvent.click(screen.getByLabelText(/Project menu/i));
        fireEvent.click(screen.getByText('Project One'));

        await waitFor(() => expect(saveProject).toHaveBeenCalledOnce());
        await Promise.resolve();
        await Promise.resolve();
        expect(loadRecentProject).not.toHaveBeenCalled();
        expect(notifyUser).not.toHaveBeenCalled();
    });

    it('awaits the pre-switch save, then notifies and prunes a definitively missing recent entry', async () => {
        vi.mocked(saveProject).mockResolvedValue(true);
        vi.mocked(loadRecentProject).mockResolvedValue('not-found');

        render(<RecentProjectsMenu />);
        fireEvent.click(screen.getByLabelText(/Project menu/i));
        fireEvent.click(screen.getByText('Project One'));

        await waitFor(() => expect(saveProject).toHaveBeenCalledOnce());
        await waitFor(() => expect(loadRecentProject).toHaveBeenCalledWith('proj-1', expect.anything()));
        await waitFor(() =>
            expect(notifyUser).toHaveBeenCalledWith(
                'Could not find "Project One" — removing it from recent projects.',
                'error'
            )
        );
        expect(removeFromRecentProjects).toHaveBeenCalledWith('proj-1');
    });

    it('notifies without pruning on a transient load failure', async () => {
        vi.mocked(saveProject).mockResolvedValue(true);
        vi.mocked(loadRecentProject).mockResolvedValue('failed');

        render(<RecentProjectsMenu />);
        fireEvent.click(screen.getByLabelText(/Project menu/i));
        fireEvent.click(screen.getByText('Project One'));

        await waitFor(() =>
            expect(notifyUser).toHaveBeenCalledWith('Could not open "Project One" — see logs for details.', 'error')
        );
        expect(removeFromRecentProjects).not.toHaveBeenCalled();
    });

    it('does nothing when the load is superseded by a newer transition', async () => {
        vi.mocked(saveProject).mockResolvedValue(true);
        vi.mocked(loadRecentProject).mockResolvedValue('aborted');

        render(<RecentProjectsMenu />);
        fireEvent.click(screen.getByLabelText(/Project menu/i));
        fireEvent.click(screen.getByText('Project One'));

        await waitFor(() => expect(loadRecentProject).toHaveBeenCalledWith('proj-1', expect.anything()));
        expect(notifyUser).not.toHaveBeenCalled();
        expect(removeFromRecentProjects).not.toHaveBeenCalled();
    });

    // The open project's Recent entry would otherwise run the pre-save, read the
    // named project before a closing take's own save lands, and hydrate that
    // stale read over the session (#5536). Opening the open project is a no-op.
    it('keeps the session untouched when the chosen entry is the project that is open', async () => {
        mocks.projectStoreValue.value = { dirty: false, createdAt: 1_700_000_000_000 };
        vi.mocked(saveProject).mockResolvedValue(true);

        render(<RecentProjectsMenu />);
        fireEvent.click(screen.getByLabelText(/Project menu/i));
        fireEvent.click(screen.getByText('Open Project'));

        await Promise.resolve();
        await Promise.resolve();
        expect(saveProject).not.toHaveBeenCalled();
        expect(loadRecentProject).not.toHaveBeenCalled();
        expect(notifyUser).not.toHaveBeenCalled();
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    // The store still holds the open project while a replacement is pending, so
    // choosing the open project then must withdraw the pending replacement
    // instead of leaving the session in the project chosen first (#5536).
    it('keeps the open project when its entry is chosen while another replacement is saving', async () => {
        mocks.projectStoreValue.value = { dirty: false, createdAt: 1_700_000_000_000 };
        const saves: ((saved: boolean) => void)[] = [];
        vi.mocked(saveProject).mockImplementation(
            () =>
                new Promise<boolean>((resolve) => {
                    saves.push(resolve);
                })
        );

        render(<RecentProjectsMenu />);
        fireEvent.click(screen.getByLabelText(/Project menu/i));
        fireEvent.click(screen.getByText('Project One'));
        await waitFor(() => expect(saveProject).toHaveBeenCalledTimes(1));

        fireEvent.click(screen.getByLabelText(/Project menu/i));
        fireEvent.click(screen.getByText('Open Project'));
        for (const resolve of saves) {
            resolve(true);
        }

        await waitFor(() => expect(vi.mocked(saveProject).mock.results).toHaveLength(1));
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(loadRecentProject).not.toHaveBeenCalled();
        expect(saveProject).toHaveBeenCalledTimes(1);
    });

    it('withdraws a replacement already reading its project when the open project is chosen', async () => {
        mocks.projectStoreValue.value = { dirty: false, createdAt: 1_700_000_000_000 };
        vi.mocked(saveProject).mockResolvedValue(true);
        vi.mocked(loadRecentProject).mockResolvedValue('aborted');

        render(<RecentProjectsMenu />);
        fireEvent.click(screen.getByLabelText(/Project menu/i));
        fireEvent.click(screen.getByText('Project One'));
        await waitFor(() => expect(loadRecentProject).toHaveBeenCalledTimes(1));
        const options = vi.mocked(loadRecentProject).mock.calls[0]?.[1];
        expect(options?.shouldProceed?.()).toBe(true);

        fireEvent.click(screen.getByLabelText(/Project menu/i));
        fireEvent.click(screen.getByText('Open Project'));

        expect(options?.shouldProceed?.()).toBe(false);
        expect(loadRecentProject).toHaveBeenCalledTimes(1);
    });

    it('still opens a different project chosen while another replacement is saving', async () => {
        mocks.projectStoreValue.value = { dirty: false, createdAt: 1_700_000_000_000 };
        vi.mocked(saveProject).mockResolvedValue(true);
        vi.mocked(loadRecentProject).mockResolvedValue('committed');

        render(<RecentProjectsMenu />);
        fireEvent.click(screen.getByLabelText(/Project menu/i));
        fireEvent.click(screen.getByText('Project One'));
        await waitFor(() => expect(loadRecentProject).toHaveBeenCalledTimes(1));
        const options = vi.mocked(loadRecentProject).mock.calls[0]?.[1];

        fireEvent.click(screen.getByLabelText(/Project menu/i));
        fireEvent.click(screen.getByText('Project Two'));

        expect(options?.shouldProceed?.()).toBe(true);
        await waitFor(() => expect(loadRecentProject).toHaveBeenCalledWith('proj-2', expect.anything()));
    });
});
