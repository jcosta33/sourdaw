import { type ReactElement } from "react";
import { Button } from "#/components/ui/button";
import { Plus, FolderPlus } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "#/components/ui/tooltip";
import { ScrollArea } from "#/components/ui/scroll-area";
import { useTracks } from "../hooks/useTracks";
import { TrackHeader } from "../components/TrackHeader";
import { addTrack } from "../../useCases/addTrack";
import { createFolder } from "../../useCases/folderUseCases";

export const TrackListView = (): ReactElement => {
    const { tracks, selectedTrackId } = useTracks();

    const collapsedFolders = new Set(
        tracks.filter((t) => t.kind === "folder" && t.collapsed).map((t) => t.id),
    );
    const visibleTracks = tracks.filter((t) => {
        if (!t.parentId) return true;
        return !collapsedFolders.has(t.parentId);
    });

    return (
        <div className="flex h-full w-44 shrink-0 flex-col border-r border-border/30 bg-surface-raised">
            <div className="flex items-center justify-between border-b border-border/30 px-2 py-1">
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    Tracks
                </span>
                <div className="flex items-center gap-0.5">
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon-xs"
                                aria-label="Add folder"
                                onClick={() => createFolder(`Folder ${tracks.filter((t) => t.kind === "folder").length + 1}`)}
                            >
                                <FolderPlus className="size-3" aria-hidden="true" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>Add Folder</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon-xs"
                                aria-label="Add track"
                                onClick={() => addTrack({ name: `Track ${tracks.length + 1}`, kind: "audio" })}
                            >
                                <Plus className="size-3" aria-hidden="true" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>Add Track</TooltipContent>
                    </Tooltip>
                </div>
            </div>

            <ScrollArea className="flex-1">
                <div role="grid" aria-label="Track list">
                    {visibleTracks.map((track) => (
                        <TrackHeader
                            key={track.id}
                            track={track}
                            isSelected={track.id === selectedTrackId}
                        />
                    ))}

                    {tracks.length === 0 && (
                        <div className="p-3 text-center">
                            <p className="text-xs text-muted-foreground">
                                No tracks yet
                            </p>
                            <p className="mt-1 text-[10px] text-muted-foreground/60">
                                Click + or type &quot;add audio track&quot;
                            </p>
                        </div>
                    )}
                </div>
            </ScrollArea>
        </div>
    );
};
