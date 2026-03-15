import { type ReactElement } from "react";
import { Button } from "#/components/ui/button";
import { Volume2, VolumeX, Headphones, Circle, ChevronRight, ChevronDown, Folder } from "lucide-react";
import { cn } from "#/helpers/Styles/cn";
import type { Track } from "../../models/Track";
import { muteTrack, soloTrack, selectTrack } from "../../useCases/toggleTrackState";
import { armTrack } from "../../useCases/recordingUseCases";
import { toggleFolderCollapse } from "../../useCases/folderUseCases";
import { TrackContextMenu } from "./TrackContextMenu";

type TrackHeaderProps = {
    track: Track;
    isSelected: boolean;
};

export const TrackHeader = ({ track, isSelected }: TrackHeaderProps): ReactElement => {
    if (track.kind === "folder") {
        return (
            <TrackContextMenu track={track}>
                <div
                    className={cn(
                        "flex h-(--spacing-track-height) shrink-0 items-center gap-1 border-b border-border/30 px-1 cursor-pointer",
                        isSelected && "bg-accent/30",
                    )}
                    role="row"
                    aria-selected={isSelected}
                    onClick={() => selectTrack(track.id)}
                >
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={track.collapsed ? "Expand folder" : "Collapse folder"}
                        onClick={(e) => { e.stopPropagation(); toggleFolderCollapse(track.id); }}
                        className="size-5"
                    >
                        {track.collapsed
                            ? <ChevronRight className="size-3" aria-hidden="true" />
                            : <ChevronDown className="size-3" aria-hidden="true" />}
                    </Button>
                    <Folder className="size-3 text-muted-foreground" aria-hidden="true" />
                    <span className="flex-1 truncate text-xs font-medium text-foreground">
                        {track.name}
                    </span>
                </div>
            </TrackContextMenu>
        );
    }

    return (
        <TrackContextMenu track={track}>
            <div
                className={cn(
                    "flex h-(--spacing-track-height) shrink-0 items-center gap-1 border-b border-border/30 px-2 cursor-pointer",
                    track.parentId && "pl-5",
                    isSelected && "bg-accent/30",
                )}
                role="row"
                aria-selected={isSelected}
                onClick={() => selectTrack(track.id)}
            >
                <div
                    className="h-6 w-1 shrink-0 rounded-full"
                    style={{ backgroundColor: track.color }}
                    aria-hidden="true"
                />

                <span className="flex-1 truncate text-xs font-medium text-foreground">
                    {track.name}
                </span>

                {track.frozen && (
                    <span className="text-[8px] text-blue-400 font-medium">FRZ</span>
                )}

                <div className="flex items-center gap-0.5">
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={track.armed ? `Disarm ${track.name}` : `Arm ${track.name}`}
                        aria-pressed={track.armed}
                        className={cn("size-5", track.armed && "text-red-500")}
                        onClick={(e) => { e.stopPropagation(); armTrack(track.id, !track.armed); }}
                    >
                        <Circle className={cn("size-2.5", track.armed && "fill-current")} aria-hidden="true" />
                    </Button>

                    <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={track.muted ? `Unmute ${track.name}` : `Mute ${track.name}`}
                        aria-pressed={track.muted}
                        className={cn("size-5", track.muted && "text-destructive-foreground")}
                        onClick={(e) => { e.stopPropagation(); muteTrack(track.id, !track.muted); }}
                    >
                        {track.muted ? <VolumeX className="size-3" aria-hidden="true" /> : <Volume2 className="size-3" aria-hidden="true" />}
                    </Button>

                    <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={track.soloed ? `Unsolo ${track.name}` : `Solo ${track.name}`}
                        aria-pressed={track.soloed}
                        className={cn("size-5", track.soloed && "text-yellow-400")}
                        onClick={(e) => { e.stopPropagation(); soloTrack(track.id, !track.soloed); }}
                    >
                        <Headphones className="size-3" aria-hidden="true" />
                    </Button>
                </div>
            </div>
        </TrackContextMenu>
    );
};
