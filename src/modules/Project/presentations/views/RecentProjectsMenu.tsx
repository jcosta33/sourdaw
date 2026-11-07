import { type ReactElement, type KeyboardEvent, type MouseEvent, useState } from 'react';

import {
    ChevronDown,
    Clock,
    FileDown,
    FileUp,
    LayoutTemplate,
    Music,
    Plus,
    Save,
    Trash2,
    Sparkles,
} from 'lucide-react';

import { DawKeycap } from '#/components/daw/DawKeycap';
import { Row } from '#/components/layout';
import { Button } from '#/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';
import { openExportDialog } from '#/modules/WorkspaceShell/useCases';
import { isDesktopRuntime } from '#/utils/desktopRuntime';
import { notifyUser } from '#/utils/Notification/notifyUser';
import { cn } from '#/utils/Styles/cn';

import { type TemplateCategory } from '../../models/ProjectTemplateTypes';
import { exportProjectFile } from '../../useCases/projectPersistence/fileIO/exportProjectFile';
import { pickAndImportProjectFile } from '../../useCases/projectPersistence/fileIO/pickAndImportProjectFile';
import { newProject } from '../../useCases/projectPersistence/newProject';
import { openProjectDirectoryFromPicker } from '../../useCases/projectPersistence/openProjectDirectoryFromPicker';
import { pendingProjectReplacements } from '../../useCases/projectPersistence/pendingProjectReplacements';
import { saveProject } from '../../useCases/projectPersistence/saveProject/saveProject';
import { saveProjectBeforeReplacement } from '../../useCases/projectPersistence/saveProject/saveProjectBeforeReplacement';
import { getRecentProjects, type RecentProjectEntry } from '../../useCases/recentProjects/helpers';
import { isOpenProjectKey } from '../../useCases/recentProjects/isOpenProjectKey';
import { loadRecentProject } from '../../useCases/recentProjects/loadRecentProject';
import { removeFromRecentProjects } from '../../useCases/recentProjects/removeFromRecentProjects';

import { TemplateChooser } from './TemplateChooser';

const formatRelativeTime = (timestamp: number): string => {
    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 60) {
        return 'just now';
    }
    if (minutes < 60) {
        return `${String(minutes)}m ago`;
    }
    if (hours < 24) {
        return `${String(hours)}h ago`;
    }
    if (days < 7) {
        return `${String(days)}d ago`;
    }
    return new Date(timestamp).toLocaleDateString();
};

const ITEM_CLASS =
    'w-full justify-start gap-2 rounded-none px-3 py-1.5 text-xs text-foreground hover:bg-accent/50 focus:bg-accent/50 transition-colors';
const SEPARATOR_CLASS = 'mx-2 my-1 bg-border';

export const RecentProjectsMenu = (): ReactElement => {
    const [entries, setEntries] = useState<RecentProjectEntry[]>([]);
    const [templateChooserOpen, setTemplateChooserOpen] = useState(false);
    const [templateChooserCategory, setTemplateChooserCategory] = useState<TemplateCategory | 'all'>('all');

    const handleOpenChange = (nextOpen: boolean) => {
        if (nextOpen) {
            setEntries(getRecentProjects());
        }
    };

    const handleNewProject = () => {
        const isStillChosen = pendingProjectReplacements.capture();
        void (async () => {
            // A failed save, or one that resolved with the project still dirty
            // (a plugin capture rejected before commit keeps that edit
            // uncaptured), asks whether to leave without saving; Cancel keeps
            // the project open. Choosing the open project meanwhile withdraws
            // the new project.
            const outgoingProject = await saveProjectBeforeReplacement();
            if (outgoingProject === 'stay' || !isStillChosen()) {
                return;
            }
            void newProject(undefined, { outgoingProject, shouldProceed: isStillChosen });
        })();
    };

    const handleNewFromTemplate = () => {
        setTemplateChooserCategory('all');
        setTemplateChooserOpen(true);
    };

    const handleLoadDemo = () => {
        setTemplateChooserCategory('demo');
        setTemplateChooserOpen(true);
    };

    const handleSave = () => {
        void saveProject({ requestFolderSelection: true });
    };

    const handleExportAudio = () => {
        openExportDialog();
    };

    const handleExportProject = () => {
        void exportProjectFile();
    };

    const handleImportProject = () => {
        void pickAndImportProjectFile();
    };

    const handleOpenProjectFolder = () => {
        void openProjectDirectoryFromPicker();
    };

    const handleLoad = (entry: RecentProjectEntry) => {
        // The project is already open: a reload would read its named save before
        // a closing take's own save lands and replace the session with that
        // stale read, so keep the session as it is (#5536). A replacement still
        // pending from an earlier choice is withdrawn, because the store keeps
        // this project until that replacement activates.
        if (isOpenProjectKey(entry.key)) {
            pendingProjectReplacements.withdraw();
            return;
        }
        const isStillChosen = pendingProjectReplacements.capture();
        void (async () => {
            // Await the pre-switch save (audit #568 F2). A failed save, or one
            // that resolved with the project still dirty (a plugin capture
            // rejected before commit keeps that edit uncaptured), asks whether
            // to leave without saving; Cancel keeps the project open. Then
            // react to the load outcome by reason (audit #568 F3): prune only
            // a definitively missing entry, notify on transient failure, and
            // do nothing when a newer transition superseded.
            const outgoingProject = await saveProjectBeforeReplacement();
            if (outgoingProject === 'stay' || !isStillChosen()) {
                return;
            }
            const outcome = await loadRecentProject(entry.key, { outgoingProject, shouldProceed: isStillChosen });
            if (outcome === 'not-found') {
                notifyUser(`Could not find "${entry.name}" — removing it from recent projects.`, 'error');
                removeFromRecentProjects(entry.key);
                setEntries(getRecentProjects());
            } else if (outcome === 'failed') {
                notifyUser(`Could not open "${entry.name}" — see logs for details.`, 'error');
            }
        })();
    };

    const handleRemove = (key: string, event?: MouseEvent) => {
        event?.stopPropagation();
        removeFromRecentProjects(key);
        setEntries(getRecentProjects());
    };

    const handleEntryKeyDown = (entry: RecentProjectEntry, event: KeyboardEvent) => {
        if (event.key === 'Delete' || event.key === 'Backspace') {
            event.preventDefault();
            handleRemove(entry.key);
        }
    };

    return (
        <div className="relative shrink-0">
            <DropdownMenu onOpenChange={handleOpenChange}>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                className="daw-readout-well rounded-l-none rounded-r-sm border-l-[rgba(255,249,242,0.1)] hover:bg-white/[0.04] hover:brightness-[1.06]"
                                aria-label="Project menu"
                            >
                                <ChevronDown data-testid="project-menu-chevron" className="size-3" aria-hidden="true" />
                            </Button>
                        </DropdownMenuTrigger>
                    </TooltipTrigger>
                    <TooltipContent>Project menu</TooltipContent>
                </Tooltip>
                <DropdownMenuContent
                    align="start"
                    loop
                    sideOffset={4}
                    aria-label="Project menu"
                    className="w-64 max-h-[calc(100vh-3rem)] overflow-y-auto overscroll-contain rounded-md border border-border bg-surface-overlay p-0 py-1 shadow-lg"
                >
                    {/* ── Create ── */}
                    <DropdownMenuItem className={ITEM_CLASS} data-testid="menu-new-project" onSelect={handleNewProject}>
                        <Plus className="size-3 text-muted-foreground" aria-hidden="true" />
                        New Project
                    </DropdownMenuItem>

                    <DropdownMenuItem className={ITEM_CLASS} onSelect={handleNewFromTemplate}>
                        <LayoutTemplate className="size-3 text-muted-foreground" aria-hidden="true" />
                        New from Template…
                    </DropdownMenuItem>

                    <DropdownMenuItem className={ITEM_CLASS} onSelect={handleLoadDemo}>
                        <Sparkles className="size-3 text-[var(--color-accent-mint)]" aria-hidden="true" />
                        Load Demo Project…
                    </DropdownMenuItem>

                    <DropdownMenuSeparator className={SEPARATOR_CLASS} />

                    {/* ── Save & Export ── */}
                    <DropdownMenuItem className={cn(ITEM_CLASS, 'justify-between')} onSelect={handleSave}>
                        <Row as="span" gap={2}>
                            <Save className="size-3 text-muted-foreground" aria-hidden="true" />
                            Save
                        </Row>
                        <DawKeycap compact className="border-transparent bg-transparent px-0 text-muted-foreground/60">
                            ⌘S
                        </DawKeycap>
                    </DropdownMenuItem>

                    <DropdownMenuItem className={cn(ITEM_CLASS, 'justify-between')} onSelect={handleExportAudio}>
                        <Row as="span" gap={2}>
                            <Music className="size-3 text-muted-foreground" aria-hidden="true" />
                            Export Audio…
                        </Row>
                        <DawKeycap compact className="border-transparent bg-transparent px-0 text-muted-foreground/60">
                            ⌘⇧E
                        </DawKeycap>
                    </DropdownMenuItem>

                    <DropdownMenuSeparator className={SEPARATOR_CLASS} />

                    {/* ── Project File I/O ── */}
                    {!isDesktopRuntime() && typeof window.showDirectoryPicker === 'function' && (
                        <DropdownMenuItem className={ITEM_CLASS} onSelect={handleOpenProjectFolder}>
                            <FileUp className="size-3 text-muted-foreground" aria-hidden="true" />
                            Open Project Folder…
                        </DropdownMenuItem>
                    )}
                    <DropdownMenuItem className={ITEM_CLASS} onSelect={handleExportProject}>
                        <FileDown className="size-3 text-muted-foreground" aria-hidden="true" />
                        Export Project File…
                    </DropdownMenuItem>

                    <DropdownMenuItem className={ITEM_CLASS} onSelect={handleImportProject}>
                        <FileUp className="size-3 text-muted-foreground" aria-hidden="true" />
                        Import Project File…
                    </DropdownMenuItem>

                    {/* ── Recent Projects ── */}
                    {entries.length > 0 ? <DropdownMenuSeparator className={SEPARATOR_CLASS} /> : null}

                    {entries.length > 0 ? (
                        <DropdownMenuLabel className="px-3 py-1 text-[9px] font-semibold text-muted-foreground/60 uppercase tracking-wider">
                            Recent
                        </DropdownMenuLabel>
                    ) : null}

                    {entries.map((entry) => (
                        <DropdownMenuItem
                            className={cn(ITEM_CLASS, 'group cursor-pointer')}
                            key={entry.key}
                            onSelect={() => handleLoad(entry)}
                            onKeyDown={(event) => handleEntryKeyDown(entry, event)}
                        >
                            <Clock className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                            <div className="flex-1 min-w-0">
                                <div className="text-xs text-foreground truncate">{entry.name}</div>
                                <div className="text-[10px] text-muted-foreground/60">
                                    {formatRelativeTime(entry.updatedAt)}
                                </div>
                            </div>
                            <Button
                                variant="bare"
                                size="bare"
                                type="button"
                                tabIndex={-1}
                                className="opacity-0 group-hover:opacity-100 group-focus:opacity-100 p-0.5 rounded hover:bg-destructive/20 transition-all"
                                aria-label={`Remove ${entry.name} from recent projects`}
                                onClick={(event) => handleRemove(entry.key, event)}
                            >
                                <Trash2
                                    className="size-3 text-muted-foreground hover:text-destructive"
                                    aria-hidden="true"
                                />
                            </Button>
                        </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
            </DropdownMenu>
            <TemplateChooser
                open={templateChooserOpen}
                initialCategory={templateChooserCategory}
                onClose={() => {
                    setTemplateChooserOpen(false);
                }}
            />
        </div>
    );
};
