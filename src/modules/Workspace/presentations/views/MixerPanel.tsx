import { type CSSProperties, type ReactElement, useState, useRef } from 'react';
import { ScrollArea } from '#/components/ui/scroll-area';
import { Button } from '#/components/ui/button';
import { Columns3, Save, RotateCcw, Sparkles, Pencil } from 'lucide-react';
import { useTracks } from '../hooks/useTracks';
import { useWorkspaceState } from '../hooks/useWorkspaceState';
import { workspaceStore } from '#/modules/Workspace/stores/workspaceStore';
import { type ChannelStripWidth } from '#/modules/Workspace/models/WorkspaceState';
import { ExpandedChannelStrip } from './mixer/ExpandedChannelStrip';
import { MasterChannelStrip } from './mixer/MasterChannelStrip';
import {
    saveMixerSnapshot,
    recallMixerSnapshot,
    getMixerSnapshots,
    deleteMixerSnapshot,
    renameMixerSnapshot,
    restoreMixerChannels,
    type MixerSnapshot,
} from '#/modules/Track/useCases/mixerSnapshotUseCases';
import { pushUndoEntry } from '../../useCases/workspaceViewActions';
import { MixHealthDialog } from './mixer/MixHealthDialog';

type MixerPanelProps = {
    style?: CSSProperties;
};

const STRIP_WIDTH_CLASS: Record<ChannelStripWidth, string> = {
    narrow: 'w-20',
    normal: 'w-28',
    wide: 'w-36',
};

const STRIP_WIDTH_CYCLE: Record<ChannelStripWidth, ChannelStripWidth> = {
    narrow: 'normal',
    normal: 'wide',
    wide: 'narrow',
};

export const MixerPanel = ({ style }: MixerPanelProps): ReactElement => {
    const { tracks, selectedTrackId } = useTracks();
    const { channelStripWidth } = useWorkspaceState();
    const widthClass = STRIP_WIDTH_CLASS[channelStripWidth];

    const cycleWidth = () => {
        const ws = workspaceStore.value;
        if (!ws) {
            return;
        }
        workspaceStore.set({
            ...ws,
            channelStripWidth: STRIP_WIDTH_CYCLE[ws.channelStripWidth],
        });
    };

    const [snapshots, setSnapshots] = useState<MixerSnapshot[]>(getMixerSnapshots);
    const [showSnapshots, setShowSnapshots] = useState(false);
    const [showMixHealth, setShowMixHealth] = useState(false);
    const [editingSnapshotId, setEditingSnapshotId] = useState<string | null>(null);
    const renameInputRef = useRef<HTMLInputElement>(null);

    const handleSaveSnapshot = () => {
        const name = `Snapshot ${snapshots.length + 1}`;
        saveMixerSnapshot(name);
        setSnapshots(getMixerSnapshots());
    };

    const handleRecallSnapshot = (id: string) => {
        const previous = recallMixerSnapshot(id);
        if (previous) {
            pushUndoEntry(
                'Recall mixer snapshot',
                () => restoreMixerChannels(previous),
                () => recallMixerSnapshot(id)
            );
        }
        setShowSnapshots(false);
    };

    const handleDeleteSnapshot = (id: string) => {
        deleteMixerSnapshot(id);
        setSnapshots(getMixerSnapshots());
    };

    const handleRenameCommit = (id: string, name: string) => {
        if (name.trim()) {
            renameMixerSnapshot(id, name.trim());
            setSnapshots(getMixerSnapshots());
        }
        setEditingSnapshotId(null);
    };

    return (
        <div
            className="flex shrink-0 flex-col border-t border-black/60 bg-surface-base shadow-[inset_0_1px_4px_rgba(0,0,0,0.5)]"
            style={style}
            role="region"
            aria-label="Mixer panel"
        >
            <div className="flex items-center justify-between border-b border-black/40 border-t-[var(--color-light-edge)] px-3 py-1 bg-surface-tray">
                <h2 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Mixer — {tracks.filter((t) => t.kind !== 'folder').length} channels
                </h2>
                <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Channel width: ${channelStripWidth}`}
                    title={`Channel width: ${channelStripWidth} (click to cycle)`}
                    onClick={cycleWidth}
                >
                    <Columns3 className="size-3" />
                </Button>

                <div className="w-px h-4 bg-border/30" />

                <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Save mixer snapshot"
                    title="Save mixer snapshot"
                    onClick={handleSaveSnapshot}
                >
                    <Save className="size-3" />
                </Button>

                <Button
                    variant="ghost"
                    size="icon-xs"
                    className="text-[var(--color-accent-lavender)] hover:text-[var(--color-accent-lavender)] hover:bg-[var(--color-accent-lavender)]/10"
                    aria-label="AI Mix Health Analysis"
                    title="AI Mix Health Analysis"
                    onClick={() => setShowMixHealth(true)}
                >
                    <Sparkles className="size-3" />
                </Button>

                <div className="relative">
                    <Button
                        variant={showSnapshots ? 'secondary' : 'ghost'}
                        size="icon-xs"
                        aria-label="Recall mixer snapshot"
                        title="Recall mixer snapshot"
                        onClick={() => setShowSnapshots((prev) => !prev)}
                        disabled={snapshots.length === 0}
                    >
                        <RotateCcw className="size-3" />
                    </Button>

                    {showSnapshots && snapshots.length > 0 ? (
                        <div className="absolute top-full right-0 z-50 mt-1 min-w-[140px] rounded-lg border border-border bg-popover p-1 shadow-lg">
                            {snapshots.map((snap) => (
                                <div key={snap.id} className="flex items-center gap-1">
                                    {editingSnapshotId === snap.id ? (
                                        <input
                                            ref={renameInputRef}
                                            autoFocus
                                            defaultValue={snap.name}
                                            className="flex-1 rounded px-2 py-0.5 text-[10px] bg-surface-base border border-ring outline-none"
                                            onBlur={(e) => handleRenameCommit(snap.id, e.currentTarget.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                    handleRenameCommit(snap.id, e.currentTarget.value);
                                                } else if (e.key === 'Escape') {
                                                    setEditingSnapshotId(null);
                                                }
                                            }}
                                        />
                                    ) : (
                                        <button
                                            type="button"
                                            className="flex-1 rounded px-2 py-1 text-left text-[10px] hover:bg-accent"
                                            onClick={() => handleRecallSnapshot(snap.id)}
                                        >
                                            {snap.name}
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        className="rounded px-1 py-0.5 text-[9px] text-muted-foreground hover:text-foreground hover:bg-accent"
                                        onClick={() => setEditingSnapshotId(snap.id)}
                                        aria-label={`Rename ${snap.name}`}
                                    >
                                        <Pencil className="size-2.5" />
                                    </button>
                                    <button
                                        type="button"
                                        className="rounded px-1 py-0.5 text-[9px] text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                        onClick={() => handleDeleteSnapshot(snap.id)}
                                        aria-label={`Delete ${snap.name}`}
                                    >
                                        ×
                                    </button>
                                </div>
                            ))}
                        </div>
                    ) : null}
                </div>
            </div>

            <MixHealthDialog open={showMixHealth} onOpenChange={setShowMixHealth} />

            <ScrollArea className="flex-1">
                <div className="flex h-full items-stretch gap-1 p-2">
                    {tracks
                        .filter((t) => t.kind !== 'folder')
                        .map((track) => (
                            <ExpandedChannelStrip
                                key={track.id}
                                track={track}
                                isSelected={track.id === selectedTrackId}
                                widthClass={widthClass}
                            />
                        ))}

                    <MasterChannelStrip widthClass={widthClass} />

                    {tracks.length === 0 ? (
                        <div className="flex flex-1 items-center justify-center">
                            <p className="text-xs text-muted-foreground">Add tracks to see mixer channels</p>
                        </div>
                    ) : null}
                </div>
            </ScrollArea>
        </div>
    );
};
