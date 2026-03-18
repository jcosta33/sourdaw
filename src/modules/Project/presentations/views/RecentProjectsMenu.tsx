import { type ReactElement, useState, useRef, useEffect } from 'react';
import { ChevronDown, Clock, FileDown, FileUp, LayoutTemplate, Music, Plus, Save, Trash2 } from 'lucide-react';
import { Button } from '#/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';
import {
    getRecentProjects,
    removeFromRecentProjects,
    loadRecentProject,
    type RecentProjectEntry,
} from '../../useCases/recentProjects';
import { newProject, saveProject, exportProjectFile, importProjectFile } from '../../useCases/projectPersistence';
import { TemplateChooser } from './TemplateChooser';
import { pickFiles } from '../../useCases/nativeFileDialog';

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
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (open) {
            setEntries(getRecentProjects());
        }
    }, [open]);

    useEffect(() => {
        if (!open) {
            return;
        }

        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };

        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
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
        saveProject();
        newProject();
        setOpen(false);
    };

    const handleNewFromTemplate = () => {
        setOpen(false);
        setTemplateChooserOpen(true);
    };

    const handleSave = () => {
        saveProject();
        setOpen(false);
    };

    const handleExportAudio = () => {
        setOpen(false);
        document.dispatchEvent(new CustomEvent('webdaw:open-export'));
    };

    const handleExportProject = () => {
        exportProjectFile();
        setOpen(false);
    };

    const handleImportProject = () => {
        setOpen(false);
        void pickFiles({
            filters: [{ name: 'WebDAW Project', extensions: ['webdaw', 'json'] }],
        }).then((files) => {
            if (!files || files.length === 0) {
                return;
            }
            void importProjectFile(files[0]!);
        });
    };


    const handleLoad = (entry: RecentProjectEntry) => {
        saveProject();
        void loadRecentProject(entry.key);
        setOpen(false);
    };

    const handleRemove = (key: string, e: React.MouseEvent) => {
        e.stopPropagation();
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

            {open && (
                <div
                    className="absolute top-full left-0 mt-1 z-50 w-64 rounded-md border border-border bg-surface-overlay shadow-lg py-1"
                    role="menu"
                    aria-label="Project menu"
                >
                    {/* ── Create ── */}
                    <button
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-accent/50 transition-colors"
                        role="menuitem"
                        onClick={handleNewProject}
                    >
                        <Plus className="size-3 text-muted-foreground" aria-hidden="true" />
                        New Project
                    </button>

                    <button
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-accent/50 transition-colors"
                        role="menuitem"
                        onClick={handleNewFromTemplate}
                    >
                        <LayoutTemplate className="size-3 text-muted-foreground" aria-hidden="true" />
                        New from Template…
                    </button>

                    <div className="mx-2 my-1 h-px bg-border" role="separator" />

                    {/* ── Save & Export ── */}
                    <button
                        type="button"
                        className="flex w-full items-center justify-between px-3 py-1.5 text-xs text-foreground hover:bg-accent/50 transition-colors"
                        role="menuitem"
                        onClick={handleSave}
                    >
                        <span className="flex items-center gap-2">
                            <Save className="size-3 text-muted-foreground" aria-hidden="true" />
                            Save
                        </span>
                        <kbd className="text-[10px] text-muted-foreground/60">⌘S</kbd>
                    </button>

                    <button
                        type="button"
                        className="flex w-full items-center justify-between px-3 py-1.5 text-xs text-foreground hover:bg-accent/50 transition-colors"
                        role="menuitem"
                        onClick={handleExportAudio}
                    >
                        <span className="flex items-center gap-2">
                            <Music className="size-3 text-muted-foreground" aria-hidden="true" />
                            Export Audio…
                        </span>
                        <kbd className="text-[10px] text-muted-foreground/60">⌘⇧E</kbd>
                    </button>

                    <div className="mx-2 my-1 h-px bg-border" role="separator" />

                    {/* ── Project File I/O ── */}
                    <button
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-accent/50 transition-colors"
                        role="menuitem"
                        onClick={handleExportProject}
                    >
                        <FileDown className="size-3 text-muted-foreground" aria-hidden="true" />
                        Export Project File…
                    </button>

                    <button
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-accent/50 transition-colors"
                        role="menuitem"
                        onClick={handleImportProject}
                    >
                        <FileUp className="size-3 text-muted-foreground" aria-hidden="true" />
                        Import Project File…
                    </button>

                    {/* ── Recent Projects ── */}
                    {entries.length > 0 && <div className="mx-2 my-1 h-px bg-border" role="separator" />}

                    {entries.length > 0 && (
                        <div className="px-3 py-1 text-[9px] font-semibold text-muted-foreground/60 uppercase tracking-wider">
                            Recent
                        </div>
                    )}

                    {entries.map((entry) => (
                        <div
                            key={entry.key}
                            className="group flex items-center gap-2 px-3 py-1.5 hover:bg-accent/50 transition-colors cursor-pointer"
                            role="menuitem"
                            tabIndex={0}
                            onClick={() => handleLoad(entry)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
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
                            <button
                                type="button"
                                className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-destructive/20 transition-all"
                                aria-label={`Remove ${entry.name} from recent projects`}
                                onClick={(e) => handleRemove(entry.key, e)}
                            >
                                <Trash2
                                    className="size-3 text-muted-foreground hover:text-destructive"
                                    aria-hidden="true"
                                />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            <TemplateChooser
                open={templateChooserOpen}
                onClose={() => {
                    setTemplateChooserOpen(false);
                }}
            />
        </div>
    );
};

