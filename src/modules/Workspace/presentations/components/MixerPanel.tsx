import { type ReactElement } from "react";
import { ScrollArea } from "#/components/ui/scroll-area";
import { Button } from "#/components/ui/button";
import { Slider } from "#/components/ui/slider";
import { Volume2, VolumeX, Headphones } from "lucide-react";
import { cn } from "#/helpers/Styles/cn";
import { useTracks } from "#/modules/Track/presentations/hooks/useTracks";
import { muteTrack, soloTrack, selectTrack } from "#/modules/Track/useCases/toggleTrackState";
import type { Track } from "#/modules/Track/models/Track";

export const MixerPanel = (): ReactElement => {
    const { tracks, selectedTrackId } = useTracks();

    return (
        <div
            className="flex h-52 shrink-0 flex-col border-t border-border bg-surface-raised"
            role="region"
            aria-label="Mixer panel"
        >
            <div className="border-b border-border/50 px-3 py-1.5">
                <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Mixer
                </h2>
            </div>

            <ScrollArea className="flex-1">
                <div className="flex h-full items-stretch gap-px p-1">
                    {tracks.map((track) => (
                        <ChannelStrip
                            key={track.id}
                            track={track}
                            isSelected={track.id === selectedTrackId}
                        />
                    ))}

                    <MasterChannelStrip />

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

const ChannelStrip = ({ track, isSelected }: { track: Track; isSelected: boolean }): ReactElement => {
    return (
        <div
            className={cn(
                "flex w-16 shrink-0 flex-col items-center gap-1 rounded px-1 py-1.5",
                "bg-surface-overlay",
                isSelected && "ring-1 ring-ring",
            )}
            onClick={() => selectTrack(track.id)}
            role="group"
            aria-label={`${track.name} channel`}
        >
            <div className="flex gap-0.5">
                <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={track.muted ? "Unmute" : "Mute"}
                    aria-pressed={track.muted}
                    className={cn("size-5", track.muted && "text-destructive-foreground")}
                    onClick={(e) => { e.stopPropagation(); muteTrack(track.id, !track.muted); }}
                >
                    {track.muted ? <VolumeX className="size-2.5" /> : <Volume2 className="size-2.5" />}
                </Button>
                <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={track.soloed ? "Unsolo" : "Solo"}
                    aria-pressed={track.soloed}
                    className={cn("size-5", track.soloed && "text-yellow-400")}
                    onClick={(e) => { e.stopPropagation(); soloTrack(track.id, !track.soloed); }}
                >
                    <Headphones className="size-2.5" />
                </Button>
            </div>

            <div className="relative flex h-full w-3 items-end rounded-full bg-muted/30">
                <div
                    className="w-full rounded-full transition-all"
                    style={{
                        height: `${track.gain * 100}%`,
                        backgroundColor: track.color,
                        opacity: track.muted ? 0.3 : 0.7,
                    }}
                />
            </div>

            <Slider
                defaultValue={[track.pan + 50]}
                max={100}
                step={1}
                className="w-12"
                aria-label={`${track.name} pan`}
            />

            <div
                className="h-0.5 w-8 rounded-full"
                style={{ backgroundColor: track.color }}
            />

            <span className="w-full truncate text-center text-[9px] text-muted-foreground">
                {track.name}
            </span>
        </div>
    );
};

const MasterChannelStrip = (): ReactElement => {
    return (
        <div
            className="flex w-16 shrink-0 flex-col items-center gap-1 rounded bg-surface-overlay px-1 py-1.5 ml-1 border-l border-border/30"
            role="group"
            aria-label="Master channel"
        >
            <span className="text-[9px] font-medium text-muted-foreground">MASTER</span>

            <div className="relative flex h-full w-3 items-end rounded-full bg-muted/30">
                <div className="w-full rounded-full bg-foreground/50" style={{ height: "80%" }} />
            </div>

            <Slider
                defaultValue={[80]}
                max={100}
                step={1}
                className="w-12"
                aria-label="Master gain"
            />

            <span className="text-[9px] font-mono text-muted-foreground">0.0 dB</span>
        </div>
    );
};
