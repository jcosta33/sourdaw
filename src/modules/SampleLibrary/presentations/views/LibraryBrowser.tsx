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
import { type ReactElement, useState, useRef } from 'react';

import { Folder, FolderPlus, ChevronRight, Search, Star, X } from 'lucide-react';

import { DawBlockedState } from '#/components/daw/DawBlockedState';
import { DawCompactInput } from '#/components/daw/DawCompactInput';
import { useStore } from '#/infra/store/useStore';
import { notifyUser } from '#/utils/Notification/notifyUser';
import { basename_from_path } from '#/utils/path-basename';

import { type FolderNode, isBrowserDecodeRisky } from '../../models/LibraryTypes';
import {
    defaultLibraryState,
    libraryStore,
    setActiveRoot,
    setCurrentFolder,
    setSearchQuery,
    setFavoritesOnly,
} from '../../stores/libraryStore';
import { connectFolder } from '../../useCases/connectFolder/connectFolder';
import { disconnectLibraryRoot } from '../../useCases/connectFolder/disconnectLibraryRoot';
import { rescanRoot } from '../../useCases/connectFolder/rescanRoot';
import { findSimilarSamples } from '../../useCases/findSimilarSamples';
import { isNativeSampleLibraryRuntimeAvailable } from '../../useCases/isNativeSampleLibraryRuntimeAvailable';
import { readNativeLibrarySampleFile } from '../../useCases/readNativeLibrarySampleFile';
import { requestPermission } from '../../useCases/requestPermission';
import { toggleFavorite } from '../../useCases/toggleFavorite';
import { LibraryRootCard } from '../components/LibraryRootCard';
import { SampleRow } from '../components/SampleRow';

import { SpatialMapRenderer } from './SpatialMapRenderer';

type LibraryPreview = {
    playingId: string | null;
    playFile: (id: string, file: File) => Promise<void>;
    stop: () => void;
};

type LibraryBrowserProps = {
    preview: LibraryPreview;
    selectedTrackId: string | null;
};

// Numeric-aware collator so file lists order "Kick 1, Kick 2, … Kick 10" rather
// than the lexicographic "Kick 1, Kick 10, Kick 2". Created once at module scope.
const fileNameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

// The embedding pipeline that feeds this projection is not wired in this build
// (no producer writes sample embeddings via setEmbedding), so re-projection is
// inert. Surface the control as unavailable instead of a button that no-ops.
const UMAP_UNAVAILABLE_LABEL = 'Timbral proximity re-projection is not available in this build';

/** Recursive file count for every folder path in a tree, rolled up once. */
function buildFileCountIndex(tree: FolderNode | undefined): Map<string, number> {
    const index = new Map<string, number>();
    if (!tree) {
        return index;
    }
    // buildFolderTree records each node's immediate file count; sum the subtree
    // bottom-up so a subfolder label lookup is O(1) instead of rescanning every
    // sample (the previous countFilesIn was O(samples) per visible subfolder).
    const rollup = (node: FolderNode): number => {
        let total = node.fileCount;
        for (const child of node.children) {
            total += rollup(child);
        }
        index.set(node.path, total);
        return total;
    };
    rollup(tree);
    return index;
}

export const LibraryBrowser = ({ preview, selectedTrackId: _selectedTrackId }: LibraryBrowserProps): ReactElement => {
    const state = useStore(libraryStore, defaultLibraryState);

    const [showSearch, setShowSearch] = useState(false);
    const [showMap, setShowMap] = useState(false);
    // Roving-tabindex cursor for the sample listbox.
    const [activeIndex, setActiveIndex] = useState(0);
    const listRef = useRef<HTMLDivElement>(null);

    // Cache resolved directory sub-handles per root+folder so repeated previews
    // of clips in the same folder do not re-walk the handle chain (one IPC trip
    // per path segment) on every click.
    const dirHandleCacheRef = useRef<Map<string, FileSystemDirectoryHandle>>(new Map());

    if (!state) {
        return <div />;
    }

    const activeRootId = state.activeRootId;
    // Roll the tree's per-folder counts into recursive totals once per render;
    // React Compiler memoizes this, so countFilesIn is an O(1) Map lookup.
    const fileCountIndex = buildFileCountIndex(activeRootId ? state.folderTrees[activeRootId] : undefined);

    const { roots, samples, currentFolder, searchQuery, favoritesOnly, scanning, scanProgress } = state;

    const activeRoot = roots.find((r) => r.id === activeRootId);
    const nativeRuntimeAvailable = isNativeSampleLibraryRuntimeAvailable();
    const showBrowserDecodeWarnings = !nativeRuntimeAvailable;

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
        if (q.startsWith('similar:')) {
            const sampleId = searchQuery.split(':')[1];
            const similarIds = findSimilarSamples(sampleId!);
            visibleFiles = rootSamples.filter((s) => similarIds.includes(s.id));
        } else {
            visibleFiles = rootSamples.filter(
                (s) =>
                    s.displayName.toLowerCase().includes(q) ||
                    s.relativePath.toLowerCase().includes(q) ||
                    s.tags.some((t) => t.toLowerCase().includes(q))
            );
        }
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
            } else if (sample.folder.startsWith(`${folderPrefix}/`)) {
                // Inside a subfolder: next segment after the current prefix
                const rest = sample.folder.slice(folderPrefix.length + 1);
                const nextSegment = rest.split('/')[0];
                if (nextSegment) {
                    subfolderSet.add(`${folderPrefix}/${nextSegment}`);
                }
            }
        }
        visibleSubfolders = [...subfolderSet].sort((a, b) => {
            const aName = basename_from_path(a);
            const bName = basename_from_path(b);
            return fileNameCollator.compare(aName, bName);
        });
    }

    if (favoritesOnly) {
        visibleFiles = visibleFiles.filter((s) => s.favorite);
    }
    visibleFiles = [...visibleFiles].sort((a, b) => fileNameCollator.compare(a.displayName, b.displayName));

    // ── Sample listbox: roving tabindex + arrow-key navigation ──
    const shownFiles = visibleFiles.slice(0, 500);
    const listCursor = Math.min(activeIndex, Math.max(0, shownFiles.length - 1));
    const moveListFocus = (next: number): void => {
        const clamped = Math.max(0, Math.min(shownFiles.length - 1, next));
        setActiveIndex(clamped);
        const options = listRef.current?.querySelectorAll<HTMLElement>('[role="option"]');
        options?.[clamped]?.focus();
    };
    const onOptionKeyDown =
        (index: number) =>
        (e: React.KeyboardEvent): void => {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                moveListFocus(index + 1);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                moveListFocus(index - 1);
            } else if (e.key === 'Home') {
                e.preventDefault();
                moveListFocus(0);
            } else if (e.key === 'End') {
                e.preventDefault();
                moveListFocus(shownFiles.length - 1);
            }
        };

    // Recursive file count under a folder path — used for subfolder labels.
    // O(1) lookup against the precomputed rollup; falls back to 0 for a path the
    // tree hasn't indexed yet (e.g. mid-scan before the tree is rebuilt).
    const countFilesIn = (path: string): number => fileCountIndex.get(path) ?? 0;

    const handleConnectFolder = (): void => {
        void connectFolder();
    };

    const playSample = async (sample: (typeof rootSamples)[number]): Promise<void> => {
        const root = roots.find((r) => r.id === sample.libraryRootId);
        if (!root) {
            return;
        }

        // Warn before attempting formats the browser commonly cannot decode, so a
        // failed preview is explained rather than appearing to do nothing. The
        // native (Tauri) build decodes these fine, so the warning is browser-only.
        if (showBrowserDecodeWarnings && isBrowserDecodeRisky(sample.ext)) {
            notifyUser(
                `"${sample.displayName}" is a .${sample.ext} file — your browser may not be able to preview it.`,
                'warning'
            );
        }

        try {
            let file: File;
            if (nativeRuntimeAvailable && root.provider === 'tauri' && root.rootRef) {
                file = await readNativeLibrarySampleFile({
                    rootPath: root.rootRef,
                    relativePath: sample.relativePath,
                    fallbackName: sample.displayName,
                });
            } else if (root.handle) {
                // Browser FileSystem Access API: walk the directory handle, but
                // memoize each resolved sub-handle so previewing several clips in
                // the same folder doesn't re-walk (and re-IPC) the whole chain.
                const pathParts = sample.relativePath.split('/');
                const fileName = pathParts.pop()!;
                const cache = dirHandleCacheRef.current;
                let dirHandle: FileSystemDirectoryHandle = root.handle;
                let resolvedPath = '';
                for (const part of pathParts) {
                    resolvedPath = resolvedPath ? `${resolvedPath}/${part}` : part;
                    const cacheKey = `${root.id} ${resolvedPath}`;
                    const cached = cache.get(cacheKey);
                    if (cached) {
                        dirHandle = cached;
                    } else {
                        dirHandle = await dirHandle.getDirectoryHandle(part);
                        cache.set(cacheKey, dirHandle);
                    }
                }
                const fileHandle = await dirHandle.getFileHandle(fileName);
                file = await fileHandle.getFile();
            } else {
                // No usable access path (e.g. an offline/path_missing root).
                notifyUser(`"${sample.displayName}" can't be previewed — its folder is not accessible.`, 'warning');
                return;
            }
            await preview.playFile(sample.id, file);
        } catch {
            // File access failed (moved, permissions revoked, native read error).
            notifyUser(`Could not open "${sample.displayName}" for preview.`, 'warning');
        }
    };

    const handleFindSimilar = (sampleId: string): void => {
        const similarIds = findSimilarSamples(sampleId);
        if (similarIds.length > 0) {
            setSearchQuery(`similar:${sampleId}`);
            // Logic to filter visible files by these IDs would go here
        }
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
                    aria-label="Search library"
                    aria-pressed={showSearch}
                    className={`size-5 rounded flex items-center justify-center transition-colors ${
                        showSearch ? 'bg-white/10 text-foreground' : 'text-muted-foreground/50 hover:text-foreground'
                    }`}
                    onClick={() => setShowSearch(!showSearch)}
                    title="Search library"
                >
                    <Search className="size-3" />
                </button>

                <button
                    type="button"
                    aria-label="Timbral spatial map"
                    aria-pressed={showMap}
                    className={`size-5 rounded flex items-center justify-center transition-colors ${
                        showMap
                            ? 'bg-accent-cyan/20 text-accent-cyan'
                            : 'text-muted-foreground/50 hover:text-foreground'
                    }`}
                    onClick={() => setShowMap(!showMap)}
                    title="Timbral Spatial Map (G3)"
                >
                    <span className="text-[8px] font-bold">MAP</span>
                </button>

                <button
                    type="button"
                    aria-label="Show favorites only"
                    aria-pressed={favoritesOnly}
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
                    <div
                        role="progressbar"
                        aria-label="Scanning library folder"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(scanProgress * 100)}
                        className="h-1 bg-surface-inset rounded-full overflow-hidden"
                    >
                        <div
                            className="h-full bg-amber-500 transition-all duration-300"
                            style={{ width: `${scanProgress * 100}%` }}
                        />
                    </div>
                    <span className="text-[8px] text-muted-foreground/40" aria-live="polite">
                        Scanning...
                    </span>
                </div>
            ) : null}

            {/* ── Empty state ── */}
            {roots.length === 0 ? (
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
                            onRemove={() => void disconnectLibraryRoot(root.id)}
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
                    {/* G3: Spatial Map View */}
                    {showMap ? (
                        <div className="p-2 shrink-0 border-b border-border/10">
                            <div className="flex items-center justify-between mb-1">
                                <span className="text-[9px] font-medium text-muted-foreground">
                                    Timbral Proximity Map
                                </span>
                                <button
                                    type="button"
                                    disabled
                                    className="text-[8px] text-muted-foreground/40 cursor-not-allowed"
                                    title={UMAP_UNAVAILABLE_LABEL}
                                    aria-label={`Re-project UMAP unavailable: ${UMAP_UNAVAILABLE_LABEL}`}
                                >
                                    Re-project UMAP
                                </button>
                            </div>
                            <SpatialMapRenderer
                                width={240}
                                height={180}
                                onSampleClick={(id) => {
                                    const s = rootSamples.find((x) => x.id === id);
                                    if (s) {
                                        void playSample(s);
                                    }
                                }}
                            />
                        </div>
                    ) : null}

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
                            const name = basename_from_path(subPath);
                            const count = countFilesIn(subPath);
                            return (
                                <button
                                    key={subPath}
                                    type="button"
                                    aria-label={`Open folder ${name}, ${count} file${count !== 1 ? 's' : ''}`}
                                    className="w-full flex items-center gap-2 px-2 py-0.5 rounded hover:bg-white/[0.04] text-left group"
                                    onClick={() => setCurrentFolder(subPath)}
                                >
                                    <Folder className="size-3 shrink-0 text-amber-500/60" aria-hidden="true" />
                                    <span className="flex-1 min-w-0 text-[10px] text-foreground truncate">{name}</span>
                                    <span className="text-[8px] text-muted-foreground/40 tabular-nums">{count}</span>
                                    <ChevronRight className="size-3 shrink-0 text-muted-foreground/20 group-hover:text-muted-foreground/60 transition-colors" />
                                </button>
                            );
                        })}

                        <div ref={listRef} role="listbox" aria-label="Samples" aria-orientation="vertical">
                            {shownFiles.map((sample, index) => (
                                <SampleRow
                                    key={sample.id}
                                    sample={sample}
                                    isPlaying={preview.playingId === sample.id}
                                    showBrowserDecodeWarnings={showBrowserDecodeWarnings}
                                    tabIndex={index === listCursor ? 0 : -1}
                                    onKeyDown={onOptionKeyDown(index)}
                                    onPlay={() => {
                                        void playSample(sample);
                                    }}
                                    onStop={preview.stop}
                                    onToggleFavorite={() => void toggleFavorite(sample.id)}
                                    onFindSimilar={() => handleFindSimilar(sample.id)}
                                    onDragStart={(e) => {
                                        e.dataTransfer.setData(
                                            'application/x-sourdaw-sample',
                                            JSON.stringify({
                                                name: sample.displayName,
                                                id: sample.id,
                                                path: sample.relativePath,
                                                libraryRootId: sample.libraryRootId,
                                                bpm: sample.analysis?.bpm,
                                                key: sample.analysis?.key,
                                            })
                                        );
                                        e.dataTransfer.effectAllowed = 'copy';
                                    }}
                                    onClick={() => {
                                        setActiveIndex(index);
                                        if (preview.playingId === sample.id) {
                                            preview.stop();
                                        } else {
                                            void playSample(sample);
                                        }
                                    }}
                                />
                            ))}
                        </div>

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
