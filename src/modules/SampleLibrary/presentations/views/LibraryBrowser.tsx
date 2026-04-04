/**
 * LibraryBrowser — main sample library view for the sidebar.
 *
 * Features:
 * - Connect folder button (plug and play, no account)
 * - Connected roots with status indicators
 * - Browsable folder tree
 * - Searchable file list with filters
 * - Sample preview, favorites, drag-to-timeline
 */
import { type ReactElement, useSyncExternalStore, useState } from 'react';
import { DawBlockedState } from '#/components/daw/DawBlockedState';
import { DawCompactInput } from '#/components/daw/DawCompactInput';
import { FolderPlus, Search, Star, X } from 'lucide-react';
import {
    libraryStore,
    type LibraryState,
    setActiveRoot,
    setCurrentFolder,
    setSearchQuery,
    setFavoritesOnly,
    toggleSampleFavorite,
    removeLibraryRoot,
    toggleFolderExpanded,
} from '../../stores/libraryStore';
import { connectFolder, rescanRoot } from '../../useCases/connectFolder';
import { requestPermission } from '../../useCases/requestPermission';
import { FolderTree } from '../components/FolderTree';
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
        folderTree,
        activeRootId,
        currentFolder,
        searchQuery,
        favoritesOnly,
        scanning,
        scanProgress,
    } = state;

    // Filter samples for current view
    const activeRoot = roots.find((r) => r.id === activeRootId);
    let filteredSamples = samples;

    // Filter by active root
    if (activeRootId) {
        filteredSamples = filteredSamples.filter((s) => s.libraryRootId === activeRootId);
    }

    // Filter by current folder
    if (currentFolder !== null) {
        filteredSamples = filteredSamples.filter((s) => s.folder === currentFolder);
    }

    // Filter by search
    if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        filteredSamples = filteredSamples.filter(
            (s) =>
                s.displayName.toLowerCase().includes(q) ||
                s.relativePath.toLowerCase().includes(q) ||
                s.tags.some((t) => t.toLowerCase().includes(q))
        );
    }

    // Filter favorites
    if (favoritesOnly) {
        filteredSamples = filteredSamples.filter((s) => s.favorite);
    }

    // Sort by name
    filteredSamples = [...filteredSamples].sort((a, b) => a.displayName.localeCompare(b.displayName));

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

            {/* ── Folder tree + file list ── */}
            {activeRoot ? (
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                    {/* Folder tree */}
                    {folderTree.length > 0 && !searchQuery.trim() ? (
                        <div className="px-1 pb-1 max-h-[200px] overflow-y-auto shrink-0 border-b border-border/10">
                            <FolderTree
                                nodes={folderTree}
                                currentFolder={currentFolder}
                                onFolderSelect={setCurrentFolder}
                                onToggleExpand={toggleFolderExpanded}
                            />
                        </div>
                    ) : null}

                    {/* Breadcrumb */}
                    {currentFolder ? (
                        <div className="flex items-center gap-1 px-2 py-0.5 shrink-0">
                            <button
                                type="button"
                                className="text-[9px] text-muted-foreground/50 hover:text-foreground"
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
                                            className={`text-[9px] ${
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

                    {/* File count */}
                    <div className="px-2 py-0.5 shrink-0">
                        <span className="text-[8px] text-muted-foreground/40">
                            {filteredSamples.length} sample{filteredSamples.length !== 1 ? 's' : ''}
                            {searchQuery.trim() ? ` matching "${searchQuery}"` : ''}
                        </span>
                    </div>

                    {/* Sample list */}
                    <div className="flex-1 overflow-y-auto px-1">
                        {filteredSamples.slice(0, 500).map((sample) => (
                            <SampleRow
                                key={sample.id}
                                sample={sample}
                                isPlaying={preview.playingId === sample.id}
                                onPlay={() => {
                                    // Preview would load audio from the file provider
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
                                    // Click to preview
                                    if (preview.playingId === sample.id) {
                                        preview.stop();
                                    } else {
                                        preview.playTone(sample.id, 440, 0.3);
                                    }
                                }}
                            />
                        ))}
                        {filteredSamples.length > 500 ? (
                            <div className="text-center py-2 text-[9px] text-muted-foreground/40">
                                Showing first 500 of {filteredSamples.length} results
                            </div>
                        ) : null}
                    </div>
                </div>
            ) : null}
        </div>
    );
};
