import { type CSSProperties, type ReactElement } from 'react';
import { ScrollArea } from '#/components/ui/scroll-area';
import { Button } from '#/components/ui/button';
import { Columns3 } from 'lucide-react';
import { useTracks } from '../hooks/useTracks';
import { useWorkspaceState } from '../hooks/useWorkspaceState';
import { workspaceStore } from '#/modules/Workspace/stores/workspaceStore';
import { type ChannelStripWidth } from '#/modules/Workspace/models/WorkspaceState';
import { ExpandedChannelStrip } from '../components/mixer/ExpandedChannelStrip';
import { MasterChannelStrip } from '../components/mixer/MasterChannelStrip';

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
