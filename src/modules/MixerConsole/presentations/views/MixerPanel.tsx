import { type CSSProperties, type ReactElement, useState, useRef } from 'react';

import { Columns3, Save, RotateCcw, Sparkles, Pencil } from 'lucide-react';

import { DawBlockedState } from '#/components/daw/DawBlockedState';
import { DawCompactInput } from '#/components/daw/DawCompactInput';
import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { DawPanelSurface } from '#/components/daw/DawPanelSurface';
import { Row } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { ScrollArea } from '#/components/ui/scroll-area';
import {
    saveMixerSnapshot,
    recallMixerSnapshot,
    getMixerSnapshots,
    deleteMixerSnapshot,
    renameMixerSnapshot,
    restoreMixerChannels,
} from '#/modules/Arrangement/useCases';
import { pushUndoEntry } from '#/modules/Command/useCases';
import { cycleChannelStripWidth } from '#/modules/WorkspaceShell/useCases';
import { useContextMenuDismiss } from '#/utils/UI/useContextMenuDismiss';

import { useTracks } from '../hooks/useTracks';
import { useWorkspaceState } from '../hooks/useWorkspaceState';

import { ExpandedChannelStrip } from './Mixer/ExpandedChannelStrip';
import { MasterChannelStrip } from './Mixer/MasterChannelStrip';
import { MixHealthDialog } from './Mixer/MixHealthDialog';

// Consumer-local shape (AGENTS.md §95 — model isolation). Only fields used by this view.
type MixerSnapshot = { id: string; name: string };
type ChannelStripWidth = 'narrow' | 'normal' | 'wide';

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
        <DawPanelSurface tone="dock" style={style} role="region" aria-label="Mixer panel">
            <DawHeaderBand
                className="rounded-none px-3 py-1.5"
                title={`Mixer - ${tracks.filter((time) => time.kind !== 'folder').length} channels`}
                titleClassName="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider"
                actions={
                    <Row gap={1}>
                        <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Channel width: ${channelStripWidth}`}
                            data-testid="mixer-channel-width"
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
                            data-testid="mixer-save-snapshot"
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
                            data-testid="mixer-ai-health"
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
                                data-testid="mixer-recall-snapshot"
                                title="Recall mixer snapshot"
                                onClick={() => setShowSnapshots((prev) => !prev)}
                                disabled={snapshots.length === 0}
                            >
                                <RotateCcw className="size-3" />
                            </Button>

                            {showSnapshots && snapshots.length > 0 ? (
                                <div
                                    ref={snapshotsRef}
                                    className="daw-floating-surface absolute top-full right-0 z-50 mt-1 min-w-[140px] rounded-lg p-1"
                                >
                                    {snapshots.map((snap) => (
                                        <Row key={snap.id} gap={1}>
                                            {editingSnapshotId === snap.id ? (
                                                <DawCompactInput
                                                    ref={renameInputRef}
                                                    autoFocus
                                                    defaultValue={snap.name}
                                                    size="micro"
                                                    className="flex-1 text-[10px]"
                                                    onBlur={(event) =>
                                                        handleRenameCommit(snap.id, event.currentTarget.value)
                                                    }
                                                    onKeyDown={(event) => {
                                                        if (event.key === 'Enter') {
                                                            handleRenameCommit(snap.id, event.currentTarget.value);
                                                        } else if (event.key === 'Escape') {
                                                            setEditingSnapshotId(null);
                                                        }
                                                    }}
                                                />
                                            ) : (
                                                <Button
                                                    variant="bare"
                                                    size="bare"
                                                    type="button"
                                                    className="flex-1 rounded px-2 py-1 text-left text-[10px] hover:bg-accent"
                                                    onClick={() => handleRecallSnapshot(snap.id)}
                                                >
                                                    {snap.name}
                                                </Button>
                                            )}
                                            <Button
                                                variant="bare"
                                                size="bare"
                                                type="button"
                                                className="rounded px-1 py-0.5 text-[9px] text-muted-foreground hover:bg-accent hover:text-foreground"
                                                onClick={() => setEditingSnapshotId(snap.id)}
                                                aria-label={`Rename ${snap.name}`}
                                            >
                                                <Pencil className="size-2.5" />
                                            </Button>
                                            <Button
                                                variant="bare"
                                                size="bare"
                                                type="button"
                                                className="rounded px-1 py-0.5 text-[9px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                                onClick={() => handleDeleteSnapshot(snap.id)}
                                                aria-label={`Delete ${snap.name}`}
                                            >
                                                ×
                                            </Button>
                                        </Row>
                                    ))}
                                </div>
                            ) : null}
                        </div>
                    </Row>
                }
            />
            <MixHealthDialog open={showMixHealth} onOpenChange={setShowMixHealth} />
            <ScrollArea className="flex-1">
                <Row align="stretch" gap={1} className="h-full p-2">
                    {tracks
                        .filter((time) => time.kind !== 'folder')
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
                        <Row grow justify="center">
                            <DawBlockedState
                                compact
                                eyebrow="Mixer"
                                className="max-w-64"
                                title="No tracks in the oven yet"
                                description="Add a few channels to start shaping the mix."
                                summary="Channel strips, meters, and send levels appear here once the session has tracks."
                            />
                        </Row>
                    ) : null}
                </Row>
            </ScrollArea>
        </DawPanelSurface>
    );
};
