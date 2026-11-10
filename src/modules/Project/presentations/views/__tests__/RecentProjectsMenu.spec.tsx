import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { confirmUser } from '#/utils/Notification/confirmUser';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { pickFiles } from '../../../useCases/fileDialog';
import { applyImportedProjectData } from '../../../useCases/projectPersistence/fileIO/applyImportedProjectData';
import { newProject } from '../../../useCases/projectPersistence/newProject';
import { openProjectDirectoryFromPicker } from '../../../useCases/projectPersistence/openProjectDirectoryFromPicker';
import { pendingProjectReplacements } from '../../../useCases/projectPersistence/pendingProjectReplacements';
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

// The Don't Save dialog's answer; Cancel unless a case chooses otherwise.
vi.mock('#/utils/Notification/confirmUser', () => ({
    confirmUser: vi.fn(),
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

vi.mock('../../../useCases/projectPersistence/openProjectDirectoryFromPicker', () => ({
    openProjectDirectoryFromPicker: vi.fn(),
}));

vi.mock('../../../useCases/projectPersistence/saveProject/saveProject', () => ({
    saveProject: vi.fn(),
}));

// The menu's import runs the real route, so a withdrawal is observed where the
// route reads the file and hands the data over.
vi.mock('../../../useCases/fileDialog', () => ({
    pickFiles: vi.fn(),
}));

vi.mock('../../../useCases/projectPersistence/helpers/runProjectLoadTransaction', () => ({
    runProjectLoadTransaction: vi.fn(() => ({ isCurrent: () => true, canActivate: () => true })),
}));

vi.mock('../../../useCases/projectPersistence/fileIO/applyImportedProjectData', () => ({
    applyImportedProjectData: vi.fn(),
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

// Radix opens a dropdown on pointer down, as a real press does.
const openProjectMenu = (): void => {
    fireEvent.pointerDown(screen.getByLabelText(/Project menu/i), { pointerId: 1, button: 0 });
};

describe('RecentProjectsMenu', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.projectStoreValue.value = null;
        vi.mocked(confirmUser).mockResolvedValue(false);
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
        fireEvent.pointerDown(button, { pointerId: 1, button: 0 });
        expect(screen.getByRole('menu')).toBeInTheDocument();
    });

    it('keeps the project menu scrollable within the renderer height', () => {
        render(<RecentProjectsMenu />);
        openProjectMenu();

        expect(screen.getByRole('menu')).toHaveClass(
            'max-h-[calc(100vh-3rem)]',
            'overflow-y-auto',
            'overscroll-contain'
        );
    });

    it('left-aligns menu rows that do not carry a trailing shortcut', () => {
        render(<RecentProjectsMenu />);
        openProjectMenu();

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
        fireEvent.pointerDown(button, { pointerId: 1, button: 0 });
        expect(screen.getByText(/New Project/i)).toBeInTheDocument();
    });

    it('should render New from Template option', () => {
        render(<RecentProjectsMenu />);
        const button = screen.getByLabelText(/Project menu/i);
        fireEvent.pointerDown(button, { pointerId: 1, button: 0 });
        expect(screen.getByText(/New from Template/i)).toBeInTheDocument();
    });

    it('should render Load Demo Project option', () => {
        render(<RecentProjectsMenu />);
        const button = screen.getByLabelText(/Project menu/i);
        fireEvent.pointerDown(button, { pointerId: 1, button: 0 });
        expect(screen.getByText(/Load Demo Project/i)).toBeInTheDocument();
    });

    it('should render Save option', () => {
        render(<RecentProjectsMenu />);
        const button = screen.getByLabelText(/Project menu/i);
        fireEvent.pointerDown(button, { pointerId: 1, button: 0 });
        expect(screen.getByText(/Save/i)).toBeInTheDocument();
    });

    it('should render Export Audio option', () => {
        render(<RecentProjectsMenu />);
        const button = screen.getByLabelText(/Project menu/i);
        fireEvent.pointerDown(button, { pointerId: 1, button: 0 });
        expect(screen.getByText(/Export Audio/i)).toBeInTheDocument();
    });

    it('should render Export Project File option', () => {
        render(<RecentProjectsMenu />);
        const button = screen.getByLabelText(/Project menu/i);
        fireEvent.pointerDown(button, { pointerId: 1, button: 0 });
        expect(screen.getByText(/Export Project File/i)).toBeInTheDocument();
    });

    it('should render Import Project File option', () => {
        render(<RecentProjectsMenu />);
        const button = screen.getByLabelText(/Project menu/i);
        fireEvent.pointerDown(button, { pointerId: 1, button: 0 });
        expect(screen.getByText(/Import Project File/i)).toBeInTheDocument();
    });

    it('opens the project folder picker when the browser supports it', () => {
        vi.stubGlobal('showDirectoryPicker', vi.fn());
        try {
            render(<RecentProjectsMenu />);
            openProjectMenu();
            fireEvent.click(screen.getByRole('menuitem', { name: 'Open Project Folder…' }));
            expect(openProjectDirectoryFromPicker).toHaveBeenCalledOnce();
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('should display recent projects section', () => {
        render(<RecentProjectsMenu />);
        const button = screen.getByLabelText(/Project menu/i);
        fireEvent.pointerDown(button, { pointerId: 1, button: 0 });
        expect(screen.getByText(/Recent/i)).toBeInTheDocument();
        expect(screen.getByText('Project One')).toBeInTheDocument();
        expect(screen.getByText('Project Two')).toBeInTheDocument();
    });

    it('should show keyboard shortcut for Save', () => {
        render(<RecentProjectsMenu />);
        const button = screen.getByLabelText(/Project menu/i);
        fireEvent.pointerDown(button, { pointerId: 1, button: 0 });
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
        openProjectMenu();
        fireEvent.click(screen.getByRole('menuitem', { name: /New Project/i }));

        await waitFor(() => expect(saveProject).toHaveBeenCalledOnce());
        expect(newProject).not.toHaveBeenCalled();

        resolveSave?.(true);
        await waitFor(() => expect(newProject).toHaveBeenCalledOnce());
    });

    it('keeps the project open when the user cancels after the pre-switch save fails', async () => {
        mocks.projectStoreValue.value = { dirty: true, createdAt: 1 };
        vi.mocked(saveProject).mockResolvedValue(false);
        vi.mocked(newProject).mockResolvedValue(true);

        render(<RecentProjectsMenu />);
        openProjectMenu();
        fireEvent.click(screen.getByRole('menuitem', { name: /New Project/i }));

        await waitFor(() => expect(confirmUser).toHaveBeenCalledOnce());
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(saveProject).toHaveBeenCalledOnce();
        expect(newProject).not.toHaveBeenCalled();
        expect(notifyUser).not.toHaveBeenCalled();
    });

    // A project that cannot be saved must not trap the user: Don't Save
    // replaces it as a discard, so nothing saves the outgoing project again.
    it("starts the new project as a discard when the user chose Don't Save after a failed save", async () => {
        mocks.projectStoreValue.value = { dirty: true, createdAt: 1 };
        vi.mocked(saveProject).mockResolvedValue(false);
        vi.mocked(confirmUser).mockResolvedValue(true);
        vi.mocked(newProject).mockResolvedValue(true);

        render(<RecentProjectsMenu />);
        openProjectMenu();
        fireEvent.click(screen.getByRole('menuitem', { name: /New Project/i }));

        await waitFor(() =>
            expect(newProject).toHaveBeenCalledWith(undefined, expect.objectContaining({ outgoingProject: 'discard' }))
        );
        expect(saveProject).toHaveBeenCalledOnce();
    });

    it("opens the recent project as a discard when the user chose Don't Save after a failed save", async () => {
        mocks.projectStoreValue.value = { dirty: true, createdAt: 1 };
        vi.mocked(saveProject).mockResolvedValue(false);
        vi.mocked(confirmUser).mockResolvedValue(true);
        vi.mocked(loadRecentProject).mockResolvedValue('committed');

        render(<RecentProjectsMenu />);
        openProjectMenu();
        fireEvent.click(screen.getByText('Project One'));

        await waitFor(() =>
            expect(loadRecentProject).toHaveBeenCalledWith(
                'proj-1',
                expect.objectContaining({ outgoingProject: 'discard' })
            )
        );
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
        openProjectMenu();
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
        openProjectMenu();
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
        openProjectMenu();
        fireEvent.click(screen.getByText('Project One'));

        await waitFor(() => expect(saveProject).toHaveBeenCalledOnce());
        await waitFor(() =>
            expect(loadRecentProject).toHaveBeenCalledWith(
                'proj-1',
                expect.objectContaining({ outgoingProject: 'save-closed-takes' })
            )
        );
        expect(confirmUser).not.toHaveBeenCalled();
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
        openProjectMenu();
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
        openProjectMenu();
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
        openProjectMenu();
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
        openProjectMenu();
        fireEvent.click(screen.getByText('Project One'));
        await waitFor(() => expect(saveProject).toHaveBeenCalledTimes(1));

        openProjectMenu();
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
        openProjectMenu();
        fireEvent.click(screen.getByText('Project One'));
        await waitFor(() => expect(loadRecentProject).toHaveBeenCalledTimes(1));
        const options = vi.mocked(loadRecentProject).mock.calls[0]?.[1];
        expect(options?.shouldProceed?.()).toBe(true);

        openProjectMenu();
        fireEvent.click(screen.getByText('Open Project'));

        expect(options?.shouldProceed?.()).toBe(false);
        expect(loadRecentProject).toHaveBeenCalledTimes(1);
    });

    it('still opens a different project chosen while another replacement is saving', async () => {
        mocks.projectStoreValue.value = { dirty: false, createdAt: 1_700_000_000_000 };
        vi.mocked(saveProject).mockResolvedValue(true);
        vi.mocked(loadRecentProject).mockResolvedValue('committed');

        render(<RecentProjectsMenu />);
        openProjectMenu();
        fireEvent.click(screen.getByText('Project One'));
        await waitFor(() => expect(loadRecentProject).toHaveBeenCalledTimes(1));
        const options = vi.mocked(loadRecentProject).mock.calls[0]?.[1];

        openProjectMenu();
        fireEvent.click(screen.getByText('Project Two'));

        expect(options?.shouldProceed?.()).toBe(true);
        await waitFor(() => expect(loadRecentProject).toHaveBeenCalledWith('proj-2', expect.anything()));
    });

    // On main a later Recent load superseded a pending New, so the last choice
    // won; the open project's entry starts no load, so it has to withdraw every
    // kind of pending replacement, not only Recent loads.
    describe('when the open project is chosen while another kind of replacement is pending', () => {
        beforeEach(() => {
            mocks.projectStoreValue.value = { dirty: false, createdAt: 1_700_000_000_000 };
        });

        const chooseOpenProject = (): void => {
            openProjectMenu();
            fireEvent.click(screen.getByText('Open Project'));
        };

        it('does not start New Project once its pre-save finishes', async () => {
            const save = Promise.withResolvers<boolean>();
            vi.mocked(saveProject).mockReturnValueOnce(save.promise);

            render(<RecentProjectsMenu />);
            openProjectMenu();
            fireEvent.click(screen.getByRole('menuitem', { name: /New Project/i }));
            await waitFor(() => expect(saveProject).toHaveBeenCalledOnce());

            chooseOpenProject();
            save.resolve(true);

            // A macrotask turn lets the route's continuation run to its end.
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(newProject).not.toHaveBeenCalled();
            expect(loadRecentProject).not.toHaveBeenCalled();
        });

        it('hands New Project a continuation check that the choice turns false', async () => {
            vi.mocked(saveProject).mockResolvedValue(true);
            const creation = Promise.withResolvers<boolean>();
            vi.mocked(newProject).mockReturnValueOnce(creation.promise);

            render(<RecentProjectsMenu />);
            openProjectMenu();
            fireEvent.click(screen.getByRole('menuitem', { name: /New Project/i }));
            await waitFor(() => expect(newProject).toHaveBeenCalledOnce());
            const options = vi.mocked(newProject).mock.calls[0]?.[1];
            expect(options?.shouldProceed?.()).toBe(true);

            chooseOpenProject();

            expect(options?.shouldProceed?.()).toBe(false);
            expect(loadRecentProject).not.toHaveBeenCalled();
            creation.resolve(false);
        });

        it('does not hand over a file import whose read finishes after the choice', async () => {
            vi.mocked(saveProject).mockResolvedValue(true);
            vi.mocked(applyImportedProjectData).mockResolvedValue(false);
            const read = Promise.withResolvers<string>();
            const file = new File([''], 'song.sourdaw');
            vi.spyOn(file, 'text').mockReturnValue(read.promise);
            vi.mocked(pickFiles).mockResolvedValue([file]);

            render(<RecentProjectsMenu />);
            openProjectMenu();
            fireEvent.click(screen.getByRole('menuitem', { name: /Import Project File/i }));
            await waitFor(() => expect(file.text).toHaveBeenCalledOnce());

            chooseOpenProject();
            read.resolve(JSON.stringify({ version: 1, meta: { name: 'Imported' } }));

            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(applyImportedProjectData).not.toHaveBeenCalled();
            expect(notifyUser).not.toHaveBeenCalled();
            expect(loadRecentProject).not.toHaveBeenCalled();
        });
    });

    it('removes only the entry whose remove button is clicked and does not load it', () => {
        // Choosing a row captures a pending replacement synchronously, before any await, so it observes the load route.
        const captureReplacement = vi.spyOn(pendingProjectReplacements, 'capture');
        render(<RecentProjectsMenu />);
        openProjectMenu();

        fireEvent.click(screen.getByRole('button', { name: 'Remove Project One from recent projects' }));

        expect(removeFromRecentProjects).toHaveBeenCalledTimes(1);
        expect(removeFromRecentProjects).toHaveBeenCalledWith('proj-1');
        expect(captureReplacement).not.toHaveBeenCalled();
        expect(loadRecentProject).not.toHaveBeenCalled();
        captureReplacement.mockRestore();
    });

    describe('keyboard navigation', () => {
        const openWithKeyboard = async (): Promise<HTMLElement[]> => {
            render(<RecentProjectsMenu />);
            const trigger = screen.getByLabelText(/Project menu/i);
            trigger.focus();
            fireEvent.keyDown(trigger, { key: 'Enter' });
            const items = await screen.findAllByRole('menuitem');
            await waitFor(() => {
                expect(document.activeElement).toBe(items[0]);
            });
            return items;
        };

        // Radix moves roving focus on the next tick, so each key is awaited through its focus result.
        const pressAndExpectFocus = async (key: string, expected: HTMLElement | undefined): Promise<void> => {
            fireEvent.keyDown(document.activeElement ?? document.body, { key });
            await waitFor(() => {
                expect(document.activeElement).toBe(expected);
            });
        };

        it('moves focus between items with the arrow keys and wraps at the ends', async () => {
            const items = await openWithKeyboard();
            const last = items[items.length - 1];

            await pressAndExpectFocus('ArrowDown', items[1]);
            await pressAndExpectFocus('ArrowDown', items[2]);
            await pressAndExpectFocus('ArrowUp', items[1]);
            await pressAndExpectFocus('ArrowUp', items[0]);
            await pressAndExpectFocus('ArrowUp', last);
            await pressAndExpectFocus('ArrowDown', items[0]);
        });

        it('jumps to the last and first item with End and Home', async () => {
            const items = await openWithKeyboard();

            await pressAndExpectFocus('End', items[items.length - 1]);
            await pressAndExpectFocus('Home', items[0]);
        });

        it('removes a recent project with Backspace without opening it', async () => {
            const items = await openWithKeyboard();
            const recent = items.find((item) => item.textContent?.includes('Project Two'));
            recent?.focus();

            fireEvent.keyDown(recent ?? document.body, { key: 'Backspace' });

            expect(removeFromRecentProjects).toHaveBeenCalledWith('proj-2');
            expect(loadRecentProject).not.toHaveBeenCalled();
        });

        it('removes a recent project with Delete without opening it', async () => {
            const items = await openWithKeyboard();
            const recent = items.find((item) => item.textContent?.includes('Project One'));
            expect(recent).toBeDefined();
            recent?.focus();

            fireEvent.keyDown(recent ?? document.body, { key: 'Delete' });

            expect(removeFromRecentProjects).toHaveBeenCalledWith('proj-1');
            expect(loadRecentProject).not.toHaveBeenCalled();
        });
    });
});
