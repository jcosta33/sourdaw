import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { notifyUser } from '#/utils/Notification/notifyUser';

import { newProject } from '../../../useCases/projectPersistence/newProject';
import { saveProject } from '../../../useCases/projectPersistence/saveProject/saveProject';
import { loadRecentProject } from '../../../useCases/recentProjects/loadRecentProject';
import { removeFromRecentProjects } from '../../../useCases/recentProjects/removeFromRecentProjects';
import { RecentProjectsMenu } from '../RecentProjectsMenu';

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
    });

    it('should render without crashing', () => {
        render(<RecentProjectsMenu />);
        expect(screen.getByLabelText(/Project menu/i)).toBeInTheDocument();
    });

    it('should show menu when button is clicked', () => {
        render(<RecentProjectsMenu />);
        const button = screen.getByLabelText(/Project menu/i);
        fireEvent.click(button);
        expect(screen.getByRole('menu')).toBeInTheDocument();
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

    it('awaits the pre-switch save, then notifies and prunes a definitively missing recent entry', async () => {
        vi.mocked(saveProject).mockResolvedValue(true);
        vi.mocked(loadRecentProject).mockResolvedValue('not-found');

        render(<RecentProjectsMenu />);
        fireEvent.click(screen.getByLabelText(/Project menu/i));
        fireEvent.click(screen.getByText('Project One'));

        await waitFor(() => expect(saveProject).toHaveBeenCalledOnce());
        await waitFor(() => expect(loadRecentProject).toHaveBeenCalledWith('proj-1'));
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

        await waitFor(() => expect(loadRecentProject).toHaveBeenCalledWith('proj-1'));
        expect(notifyUser).not.toHaveBeenCalled();
        expect(removeFromRecentProjects).not.toHaveBeenCalled();
    });
});
