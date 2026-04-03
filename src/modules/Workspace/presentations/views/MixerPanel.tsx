import { type CSSProperties, type ReactElement, useState, useRef } from 'react';
import { DawEmptyState } from '#/components/daw/DawEmptyState';
import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { useContextMenuDismiss } from '#/helpers/UI/useContextMenuDismiss';
import { ScrollArea } from '#/components/ui/scroll-area';
import { Button } from '#/components/ui/button';
import { Columns3, Save, RotateCcw, Sparkles, Pencil } from 'lucide-react';
import { useTracks } from '../hooks/useTracks';
import { useWorkspaceState } from '../hooks/useWorkspaceState';
import { cycleChannelStripWidth } from '../../useCases/togglePanel/panelToggles';
import { type ChannelStripWidth } from '../../models/WorkspaceState';
import { ExpandedChannelStrip } from './Mixer/ExpandedChannelStrip';
import { MasterChannelStrip } from './Mixer/MasterChannelStrip';
import type { MixerSnapshot } from '#/modules/Arrangement/useCases/trackQueries';
import {
    saveMixerSnapshot,
    recallMixerSnapshot,
    getMixerSnapshots,
    deleteMixerSnapshot,
    renameMixerSnapshot,
    restoreMixerChannels,
} from '#/modules/Arrangement/useCases/mixerSnapshot/operations';
import { MixHealthDialog } from './Mixer/MixHealthDialog';
import { pushUndoEntry } from '#/modules/Command/useCases/pushUndoEntry';

type MixerPanelProps = {
    style?: CSSProperties;
};

const STRIP_WIDTH_CLASS: Record<ChannelStripWidth, string> = {
    narrow: 'w-20',
    normal: 'w-28',
    wide: 'w-36',
};
export const MixerPanel = ({ style }: MixerPanelProps): ReactElement => {
    const { tracks, selectedTrackId } = useTracks();
    const { channelStripWidth } = useWorkspaceState();
    const widthClass = STRIP_WIDTH_CLASS[channelStripWidth];

    const [snapshots, setSnapshots] = useState<MixerSnapshot[]>(getMixerSnapshots);
    const [showSnapshots, setShowSnapshots] = useState(false);
    const [showMixHealth, setShowMixHealth] = useState(false);
    const [editingSnapshotId, setEditingSnapshotId] = useState<string | null>(null);
    const renameInputRef = useRef<HTMLInputElement>(null);
    const snapshotsRef = useRef<HTMLDivElement>(null);

    useContextMenuDismiss(snapshotsRef, () => {
        setShowSnapshots(false);
        setEditingSnapshotId(null);
    });

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
            <DawHeaderBand
                className="rounded-none px-3 py-1.5"
                title={`Mixer - ${tracks.filter((t) => t.kind !== 'folder').length} channels`}
                titleClassName="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider"
                actions={
                    <div className="flex items-center gap-1">
                        <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Channel width: ${channelStripWidth}`}
                            title={`Channel width: ${channelStripWidth} (click to cycle)`}
                            onClick={cycleChannelStripWidth}
                        >
                            <Columns3 className="size-3" />
                        </Button>

                        <div className="h-4 w-px daw-seam" />

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
                            className="text-[var(--color-accent-lavender)] hover:bg-[var(--color-accent-lavender)]/10 hover:text-[var(--color-accent-lavender)]"
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
                                <div ref={snapshotsRef} className="absolute top-full right-0 z-50 mt-1 min-w-[140px] rounded-lg border border-border bg-popover p-1 shadow-lg">
                                    {snapshots.map((snap) => (
                                        <div key={snap.id} className="flex items-center gap-1">
                                            {editingSnapshotId === snap.id ? (
                                                <input
                                                    ref={renameInputRef}
                                                    autoFocus
                                                    defaultValue={snap.name}
                                                    className="flex-1 rounded border border-ring bg-surface-base px-2 py-0.5 text-[10px] outline-none"
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
                                                className="rounded px-1 py-0.5 text-[9px] text-muted-foreground hover:bg-accent hover:text-foreground"
                                                onClick={() => setEditingSnapshotId(snap.id)}
                                                aria-label={`Rename ${snap.name}`}
                                            >
                                                <Pencil className="size-2.5" />
                                            </button>
                                            <button
                                                type="button"
                                                className="rounded px-1 py-0.5 text-[9px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
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
                }
            />

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
                            <DawEmptyState
                                compact
                                className="max-w-64"
                                title="No tracks in the oven yet"
                                description="Add a few channels to start shaping the mix."
                            />
                        </div>
                    ) : null}
                </div>
            </ScrollArea>
        </div>
    );
};
