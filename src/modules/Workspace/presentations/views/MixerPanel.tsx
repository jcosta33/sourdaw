import { type CSSProperties, type ReactElement, useState, useCallback } from 'react';
import { ScrollArea } from '#/components/ui/scroll-area';
import { Button } from '#/components/ui/button';
import { Columns3, Save, RotateCcw } from 'lucide-react';
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
    restoreMixerChannels,
    type MixerSnapshot,
} from '#/modules/Track/useCases/mixerSnapshotUseCases';
import { pushUndoEntry } from '../../useCases/workspaceViewActions';

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

    const handleSaveSnapshot = useCallback(() => {
        const name = `Snapshot ${snapshots.length + 1}`;
        saveMixerSnapshot(name);
        setSnapshots(getMixerSnapshots());
    }, [snapshots.length]);

    const handleRecallSnapshot = useCallback((id: string) => {
        const previous = recallMixerSnapshot(id);
        if (previous) {
            pushUndoEntry(
                'Recall mixer snapshot',
                () => restoreMixerChannels(previous),
                () => recallMixerSnapshot(id)
            );
        }
        setShowSnapshots(false);
    }, []);

    const handleDeleteSnapshot = useCallback((id: string) => {
        deleteMixerSnapshot(id);
        setSnapshots(getMixerSnapshots());
    }, []);

    return (
        <div
            className="flex shrink-0 flex-col border-t border-border bg-surface-raised"
            style={style}
            role="region"
            aria-label="Mixer panel"
        >
            <div className="flex items-center justify-between border-b border-border/50 px-3 py-1">
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

                    {showSnapshots && snapshots.length > 0 && (
                        <div className="absolute top-full right-0 z-50 mt-1 min-w-[140px] rounded-lg border border-border bg-surface-overlay p-1 shadow-lg">
                            {snapshots.map((snap) => (
                                <div key={snap.id} className="flex items-center gap-1">
                                    <button
                                        type="button"
                                        className="flex-1 rounded px-2 py-1 text-left text-[10px] hover:bg-accent"
                                        onClick={() => handleRecallSnapshot(snap.id)}
                                    >
                                        {snap.name}
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
                    )}
                </div>
            </div>

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

                    {tracks.length === 0 && (
                        <div className="flex flex-1 items-center justify-center">
                            <p className="text-xs text-muted-foreground">Add tracks to see mixer channels</p>
                        </div>
                    )}
                </div>
            </ScrollArea>
        </div>
    );
};
