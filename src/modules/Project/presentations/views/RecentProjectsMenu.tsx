import { type ReactElement, useState, useRef, useEffect } from 'react';

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
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';
import { openExportDialog } from '#/modules/WorkspaceShell/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { type TemplateCategory } from '../../models/ProjectTemplateTypes';
import { exportProjectFile } from '../../useCases/projectPersistence/fileIO/exportProjectFile';
import { pickAndImportProjectFile } from '../../useCases/projectPersistence/fileIO/pickAndImportProjectFile';
import { newProject } from '../../useCases/projectPersistence/newProject';
import { saveProject } from '../../useCases/projectPersistence/saveProject/saveProject';
import { getRecentProjects, type RecentProjectEntry } from '../../useCases/recentProjects/helpers';
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

export const RecentProjectsMenu = (): ReactElement => {
    const [open, setOpen] = useState(false);
    const [entries, setEntries] = useState<RecentProjectEntry[]>([]);
    const [templateChooserOpen, setTemplateChooserOpen] = useState(false);
    const [templateChooserCategory, setTemplateChooserCategory] = useState<TemplateCategory | 'all'>('all');
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (open) {
            setEntries(getRecentProjects());
        }
    }, [open]);

    useEffect(() => {
        if (!open) {
            return undefined;
        }

        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setOpen(false);
            }
        };

        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleEscape);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleEscape);
        };
    }, [open]);

    const handleNewProject = () => {
        void (async () => {
            // Abort on a failed save (already notified) so the current
            // project stays open with its unsaved work.
            if (!(await saveProject())) {
                return;
            }
            void newProject();
        })();
        setOpen(false);
    };

    const handleNewFromTemplate = () => {
        setOpen(false);
        setTemplateChooserCategory('all');
        setTemplateChooserOpen(true);
    };

    const handleLoadDemo = () => {
        setOpen(false);
        setTemplateChooserCategory('demo');
        setTemplateChooserOpen(true);
    };

    const handleSave = () => {
        void saveProject();
        setOpen(false);
    };

    const handleExportAudio = () => {
        setOpen(false);
        openExportDialog();
    };

    const handleExportProject = () => {
        void exportProjectFile();
        setOpen(false);
    };

    const handleImportProject = () => {
        setOpen(false);
        void pickAndImportProjectFile();
    };

    const handleLoad = (entry: RecentProjectEntry) => {
        void (async () => {
            // Await the pre-switch save (audit #568 F2) and abort on its
            // failure; react to the load outcome by reason (audit #568 F3):
            // prune only a definitively missing entry, notify on transient
            // failure, and do nothing when a newer transition superseded.
            if (!(await saveProject())) {
                return;
            }
            const outcome = await loadRecentProject(entry.key);
            if (outcome === 'not-found') {
                notifyUser(`Could not find "${entry.name}" — removing it from recent projects.`, 'error');
                removeFromRecentProjects(entry.key);
                setEntries(getRecentProjects());
            } else if (outcome === 'failed') {
                notifyUser(`Could not open "${entry.name}" — see logs for details.`, 'error');
            }
        })();
        setOpen(false);
    };

    const handleRemove = (key: string, event: React.MouseEvent) => {
        event.stopPropagation();
        removeFromRecentProjects(key);
        setEntries(getRecentProjects());
    };

    return (
        <div className="relative" ref={menuRef}>
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        className="daw-readout-well"
                        aria-label="Project menu"
                        aria-expanded={open}
                        aria-haspopup="menu"
                        onClick={() => setOpen((prev) => !prev)}
                    >
                        <ChevronDown className="size-3" aria-hidden="true" />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>Project menu</TooltipContent>
            </Tooltip>
            {open ? (
                <div
                    className="absolute top-full left-0 mt-1 z-50 w-64 rounded-md border border-border bg-surface-overlay shadow-lg py-1"
                    role="menu"
                    aria-label="Project menu"
                >
                    {/* ── Create ── */}
                    <Button
                        variant="bare"
                        size="bare"
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-accent/50 transition-colors"
                        role="menuitem"
                        data-testid="menu-new-project"
                        onClick={handleNewProject}
                    >
                        <Plus className="size-3 text-muted-foreground" aria-hidden="true" />
                        New Project
                    </Button>

                    <Button
                        variant="bare"
                        size="bare"
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-accent/50 transition-colors"
                        role="menuitem"
                        onClick={handleNewFromTemplate}
                    >
                        <LayoutTemplate className="size-3 text-muted-foreground" aria-hidden="true" />
                        New from Template…
                    </Button>

                    <Button
                        variant="bare"
                        size="bare"
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-accent/50 transition-colors"
                        role="menuitem"
                        onClick={handleLoadDemo}
                    >
                        <Sparkles className="size-3 text-[var(--color-accent-mint)]" aria-hidden="true" />
                        Load Demo Project…
                    </Button>

                    <div className="mx-2 my-1 h-px bg-border" role="separator" />

                    {/* ── Save & Export ── */}
                    <Button
                        variant="bare"
                        size="bare"
                        type="button"
                        className="flex w-full items-center justify-between px-3 py-1.5 text-xs text-foreground hover:bg-accent/50 transition-colors"
                        role="menuitem"
                        onClick={handleSave}
                    >
                        <Row as="span" gap={2}>
                            <Save className="size-3 text-muted-foreground" aria-hidden="true" />
                            Save
                        </Row>
                        <DawKeycap compact className="border-transparent bg-transparent px-0 text-muted-foreground/60">
                            ⌘S
                        </DawKeycap>
                    </Button>

                    <Button
                        variant="bare"
                        size="bare"
                        type="button"
                        className="flex w-full items-center justify-between px-3 py-1.5 text-xs text-foreground hover:bg-accent/50 transition-colors"
                        role="menuitem"
                        onClick={handleExportAudio}
                    >
                        <Row as="span" gap={2}>
                            <Music className="size-3 text-muted-foreground" aria-hidden="true" />
                            Export Audio…
                        </Row>
                        <DawKeycap compact className="border-transparent bg-transparent px-0 text-muted-foreground/60">
                            ⌘⇧E
                        </DawKeycap>
                    </Button>

                    <div className="mx-2 my-1 h-px bg-border" role="separator" />

                    {/* ── Project File I/O ── */}
                    <Button
                        variant="bare"
                        size="bare"
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-accent/50 transition-colors"
                        role="menuitem"
                        onClick={handleExportProject}
                    >
                        <FileDown className="size-3 text-muted-foreground" aria-hidden="true" />
                        Export Project File…
                    </Button>

                    <Button
                        variant="bare"
                        size="bare"
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-accent/50 transition-colors"
                        role="menuitem"
                        onClick={handleImportProject}
                    >
                        <FileUp className="size-3 text-muted-foreground" aria-hidden="true" />
                        Import Project File…
                    </Button>

                    {/* ── Recent Projects ── */}
                    {entries.length > 0 ? <div className="mx-2 my-1 h-px bg-border" role="separator" /> : null}

                    {entries.length > 0 ? (
                        <div className="px-3 py-1 text-[9px] font-semibold text-muted-foreground/60 uppercase tracking-wider">
                            Recent
                        </div>
                    ) : null}

                    {entries.map((entry) => (
                        <Row
                            gap={2}
                            className="group px-3 py-1.5 hover:bg-accent/50 transition-colors cursor-pointer"
                            key={entry.key}
                            role="menuitem"
                            tabIndex={0}
                            onClick={() => handleLoad(entry)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault();
                                    handleLoad(entry);
                                }
                            }}
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
                                className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-destructive/20 transition-all"
                                aria-label={`Remove ${entry.name} from recent projects`}
                                onClick={(event) => handleRemove(entry.key, event)}
                            >
                                <Trash2
                                    className="size-3 text-muted-foreground hover:text-destructive"
                                    aria-hidden="true"
                                />
                            </Button>
                        </Row>
                    ))}
                </div>
            ) : null}
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
