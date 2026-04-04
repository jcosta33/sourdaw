/**
 * LibraryBrowser — main sample library view for the sidebar.
 *
 * Features:
 * - Connect folder button (plug and play, no account)
 * - Connected roots with status indicators
 * - File-explorer view: folders and audio files in a unified navigatable list
 * - Searchable across entire root
 * - Sample preview, favorites, drag-to-timeline
 */
import { type ReactElement, useSyncExternalStore, useState } from 'react';
import { DawBlockedState } from '#/components/daw/DawBlockedState';
import { DawCompactInput } from '#/components/daw/DawCompactInput';
import { Folder, FolderPlus, ChevronRight, Search, Star, X } from 'lucide-react';
import {
    libraryStore,
    type LibraryState,
    setActiveRoot,
    setCurrentFolder,
    setSearchQuery,
    setFavoritesOnly,
    toggleSampleFavorite,
    removeLibraryRoot,
} from '../../stores/libraryStore';
import { connectFolder, rescanRoot } from '../../useCases/connectFolder';
import { requestPermission } from '../../useCases/requestPermission';
import { SampleRow } from '../components/SampleRow';
import { LibraryRootCard } from '../components/LibraryRootCard';
import { type PreviewHandle } from '#/modules/Workspace/presentations/hooks/usePreviewAudio';

type LibraryBrowserProps = {
    preview: PreviewHandle;
    selectedTrackId: string | null;
};

export const LibraryBrowser = ({ preview, selectedTrackId: _selectedTrackId }: LibraryBrowserProps): ReactElement => {
    const state = useSyncExternalStore<LibraryState | null>(
        (cb) => libraryStore.subscribe(cb),
        () => libraryStore.value
    );

    const [showSearch, setShowSearch] = useState(false);

    if (!state) {
        return <div />;
    }

    const {
        roots,
        samples,
        activeRootId,
        currentFolder,
        searchQuery,
        favoritesOnly,
        scanning,
        scanProgress,
    } = state;

    const activeRoot = roots.find((r) => r.id === activeRootId);

    // All samples for the active root
    const rootSamples = activeRootId ? samples.filter((s) => s.libraryRootId === activeRootId) : [];

    // Current folder path — empty string means root level
    const folderPrefix = currentFolder ?? '';

    // When searching: flat list of all matching files across entire root
    // When browsing: immediate subfolders + direct files at current level
    let visibleFiles = rootSamples.filter((s) => s.folder === folderPrefix);
    let visibleSubfolders: string[] = [];

    if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        visibleFiles = rootSamples.filter(
            (s) =>
                s.displayName.toLowerCase().includes(q) ||
                s.relativePath.toLowerCase().includes(q) ||
                s.tags.some((t) => t.toLowerCase().includes(q))
        );
    } else {
        // Collect unique immediate subfolders at the current level
        const subfolderSet = new Set<string>();
        for (const sample of rootSamples) {
            if (folderPrefix === '') {
                // At root: first path segment of any non-root folder
                if (sample.folder !== '') {
                    const topSegment = sample.folder.split('/')[0];
                    if (topSegment) {
                        subfolderSet.add(topSegment);
                    }
                }
            } else if (sample.folder.startsWith(folderPrefix + '/')) {
                // Inside a subfolder: next segment after the current prefix
                const rest = sample.folder.slice(folderPrefix.length + 1);
                const nextSegment = rest.split('/')[0];
                if (nextSegment) {
                    subfolderSet.add(`${folderPrefix}/${nextSegment}`);
                }
            }
        }
        visibleSubfolders = [...subfolderSet].sort((a, b) => {
            const aName = a.split('/').pop() ?? a;
            const bName = b.split('/').pop() ?? b;
            return aName.localeCompare(bName);
        });
    }

    if (favoritesOnly) {
        visibleFiles = visibleFiles.filter((s) => s.favorite);
    }
    visibleFiles = [...visibleFiles].sort((a, b) => a.displayName.localeCompare(b.displayName));

    // Recursive file count under a folder path — used for subfolder labels
    const countFilesIn = (path: string): number =>
        rootSamples.filter((s) => s.folder === path || s.folder.startsWith(path + '/')).length;

    const handleConnectFolder = (): void => {
        void connectFolder();
    };

    return (
        <div className="flex flex-col h-full">
            {/* ── Header ── */}
            <div className="flex items-center gap-1 px-2 pb-1 shrink-0">
                <button
                    type="button"
                    className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-foreground/70 hover:text-foreground hover:bg-white/[0.06] transition-colors"
                    onClick={handleConnectFolder}
                >
                    <FolderPlus className="size-3" />
                    Connect Folder
                </button>
                <div className="flex-1" />
                <button
                    type="button"
                    className={`size-5 rounded flex items-center justify-center transition-colors ${
                        showSearch ? 'bg-white/10 text-foreground' : 'text-muted-foreground/50 hover:text-foreground'
                    }`}
                    onClick={() => setShowSearch(!showSearch)}
                >
                    <Search className="size-3" />
                </button>
                <button
                    type="button"
                    className={`size-5 rounded flex items-center justify-center transition-colors ${
                        favoritesOnly
                            ? 'bg-amber-500/20 text-amber-400'
                            : 'text-muted-foreground/50 hover:text-foreground'
                    }`}
                    onClick={() => setFavoritesOnly(!favoritesOnly)}
                    title="Show favorites only"
                >
                    <Star className="size-3" />
                </button>
            </div>

            {/* ── Search bar ── */}
            {showSearch ? (
                <div className="flex items-center gap-1 px-2 pb-1 shrink-0">
                    <Search className="size-3 text-muted-foreground/40 shrink-0" />
                    <DawCompactInput
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search samples..."
                        size="micro"
                        className="flex-1 border-0 bg-transparent px-0 text-[10px] text-foreground shadow-none placeholder:text-muted-foreground/30 focus-visible:ring-0"
                        autoFocus
                    />
                    {searchQuery ? (
                        <button
                            type="button"
                            className="size-3 text-muted-foreground/40 hover:text-foreground"
                            onClick={() => setSearchQuery('')}
                        >
                            <X className="size-3" />
                        </button>
                    ) : null}
                </div>
            ) : null}

            {/* ── Scan progress ── */}
            {scanning ? (
                <div className="px-2 pb-1 shrink-0">
                    <div className="h-1 bg-surface-inset rounded-full overflow-hidden">
                        <div
                            className="h-full bg-amber-500 transition-all duration-300"
                            style={{ width: `${scanProgress * 100}%` }}
                        />
                    </div>
                    <span className="text-[8px] text-muted-foreground/40">Scanning...</span>
                </div>
            ) : null}

            {/* ── Empty state ── */}
            {roots.length === 0 ? (
                <div className="px-4 py-10">
                    <DawBlockedState
                        eyebrow="Sample Library"
                        icon={<FolderPlus className="size-8" />}
                        title="No folders connected"
                        description="Connect a folder from your computer to browse and search your samples."
                        summary="Local folders only. No upload, no account, and your files stay on your machine."
                        action={
                            <button
                                type="button"
                                className="rounded-md bg-white/[0.08] px-3 py-1.5 text-[11px] font-medium text-foreground transition-colors hover:bg-white/[0.12]"
                                onClick={handleConnectFolder}
                            >
                                Connect Sample Folder
                            </button>
                        }
                    />
                </div>
            ) : null}

            {/* ── Connected roots ── */}
            {roots.length > 0 ? (
                <div className="px-1 pb-1 space-y-0.5 shrink-0">
                    {roots.map((root) => (
                        <LibraryRootCard
                            key={root.id}
                            root={root}
                            isActive={activeRootId === root.id}
                            onSelect={() => setActiveRoot(activeRootId === root.id ? null : root.id)}
                            onRescan={() => void rescanRoot(root.id)}
                            onRemove={() => removeLibraryRoot(root.id)}
                            onRequestPermission={
                                root.status === 'permission_required'
                                    ? () => void requestPermission(root.id)
                                    : undefined
                            }
                        />
                    ))}
                </div>
            ) : null}

            {/* ── File explorer ── */}
            {activeRoot ? (
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                    {/* Breadcrumb — shown when navigated into a subfolder */}
                    {currentFolder ? (
                        <div className="flex items-center gap-1 px-2 py-1 shrink-0 border-b border-border/10 flex-wrap">
                            <button
                                type="button"
                                className="text-[9px] text-muted-foreground/50 hover:text-foreground transition-colors"
                                onClick={() => setCurrentFolder(null)}
                            >
                                {activeRoot.name}
                            </button>
                            {currentFolder.split('/').map((part, i, arr) => {
                                const partPath = arr.slice(0, i + 1).join('/');
                                return (
                                    <span key={partPath} className="flex items-center gap-1">
                                        <span className="text-[9px] text-muted-foreground/30">/</span>
                                        <button
                                            type="button"
                                            className={`text-[9px] transition-colors ${
                                                i === arr.length - 1
                                                    ? 'text-foreground font-medium'
                                                    : 'text-muted-foreground/50 hover:text-foreground'
                                            }`}
                                            onClick={() => setCurrentFolder(partPath)}
                                        >
                                            {part}
                                        </button>
                                    </span>
                                );
                            })}
                        </div>
                    ) : null}

                    {/* Status line */}
                    <div className="px-2 py-0.5 shrink-0">
                        <span className="text-[8px] text-muted-foreground/40">
                            {searchQuery.trim()
                                ? `${visibleFiles.length} result${visibleFiles.length !== 1 ? 's' : ''} for "${searchQuery}"`
                                : `${visibleSubfolders.length > 0 ? `${visibleSubfolders.length} folder${visibleSubfolders.length !== 1 ? 's' : ''} · ` : ''}${visibleFiles.length} file${visibleFiles.length !== 1 ? 's' : ''}`}
                        </span>
                    </div>

                    {/* Unified list: subfolders then files */}
                    <div className="flex-1 overflow-y-auto px-1">
                        {visibleSubfolders.map((subPath) => {
                            const name = subPath.split('/').pop() ?? subPath;
                            const count = countFilesIn(subPath);
                            return (
                                <button
                                    key={subPath}
                                    type="button"
                                    className="w-full flex items-center gap-2 px-2 py-0.5 rounded hover:bg-white/[0.04] text-left group"
                                    onClick={() => setCurrentFolder(subPath)}
                                >
                                    <Folder className="size-3 shrink-0 text-amber-500/60" />
                                    <span className="flex-1 min-w-0 text-[10px] text-foreground truncate">{name}</span>
                                    <span className="text-[8px] text-muted-foreground/40 tabular-nums">{count}</span>
                                    <ChevronRight className="size-3 shrink-0 text-muted-foreground/20 group-hover:text-muted-foreground/60 transition-colors" />
                                </button>
                            );
                        })}

                        {visibleFiles.slice(0, 500).map((sample) => (
                            <SampleRow
                                key={sample.id}
                                sample={sample}
                                isPlaying={preview.playingId === sample.id}
                                onPlay={() => {
                                    preview.playTone(sample.id, 440, 0.3);
                                }}
                                onStop={preview.stop}
                                onToggleFavorite={() => toggleSampleFavorite(sample.id)}
                                onDragStart={(e) => {
                                    e.dataTransfer.setData(
                                        'application/x-sourdaw-sample',
                                        JSON.stringify({
                                            name: sample.displayName,
                                            id: sample.id,
                                            path: sample.relativePath,
                                            libraryRootId: sample.libraryRootId,
                                        })
                                    );
                                    e.dataTransfer.effectAllowed = 'copy';
                                }}
                                onClick={() => {
                                    if (preview.playingId === sample.id) {
                                        preview.stop();
                                    } else {
                                        preview.playTone(sample.id, 440, 0.3);
                                    }
                                }}
                            />
                        ))}

                        {visibleFiles.length > 500 ? (
                            <div className="text-center py-2 text-[9px] text-muted-foreground/40">
                                Showing first 500 of {visibleFiles.length} files
                            </div>
                        ) : null}
                    </div>
                </div>
            ) : null}
        </div>
    );
};
