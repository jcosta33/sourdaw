import { type ReactElement } from "react";
import { ScrollArea } from "#/components/ui/scroll-area";
import { Slider } from "#/components/ui/slider";
import { Button } from "#/components/ui/button";
import { Volume2, VolumeX, Headphones } from "lucide-react";
import { cn } from "#/helpers/Styles/cn";
import { useTracks } from "#/modules/Track/presentations/hooks/useTracks";
import { muteTrack, soloTrack, selectTrack } from "#/modules/Track/useCases/toggleTrackState";
import type { Track } from "#/modules/Track/models/Track";

export const MixView = (): ReactElement => {
    const { tracks, selectedTrackId } = useTracks();

    return (
        <div className="flex h-full flex-col">
            <div className="border-b border-border/50 px-3 py-1.5">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Mixer — {tracks.length} channels
                </span>
            </div>

            <ScrollArea className="flex-1">
                <div className="flex items-stretch gap-1 p-2 min-h-full">
                    {tracks.map((track) => (
                        <ExpandedChannelStrip
                            key={track.id}
                            track={track}
                            isSelected={track.id === selectedTrackId}
                        />
                    ))}

                    <ExpandedMasterStrip />

                    {tracks.length === 0 && (
                        <div className="flex flex-1 items-center justify-center">
                            <p className="text-sm text-muted-foreground">Add tracks to see mixer channels</p>
                        </div>
                    )}
                </div>
            </ScrollArea>
        </div>
    );
};

const ExpandedChannelStrip = ({ track, isSelected }: { track: Track; isSelected: boolean }): ReactElement => {
    return (
        <div
            className={cn(
                "flex w-24 shrink-0 flex-col items-center gap-2 rounded-lg p-2",
                "bg-surface-overlay",
                isSelected && "ring-1 ring-ring",
            )}
            onClick={() => selectTrack(track.id)}
        >
            <div
                className="h-1 w-full rounded-full"
                style={{ backgroundColor: track.color }}
            />

            <span className="w-full truncate text-center text-xs font-medium text-foreground">
                {track.name}
            </span>

            <span className="text-[9px] text-muted-foreground capitalize">{track.kind}</span>

            <div className="flex gap-1">
                <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-pressed={track.muted}
                    className={cn(track.muted && "text-destructive-foreground bg-destructive/20")}
                    onClick={(e) => { e.stopPropagation(); muteTrack(track.id, !track.muted); }}
                    aria-label={track.muted ? "Unmute" : "Mute"}
                >
                    {track.muted ? <VolumeX className="size-3" /> : <Volume2 className="size-3" />}
                </Button>
                <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-pressed={track.soloed}
                    className={cn(track.soloed && "text-yellow-400 bg-yellow-400/10")}
                    onClick={(e) => { e.stopPropagation(); soloTrack(track.id, !track.soloed); }}
                    aria-label={track.soloed ? "Unsolo" : "Solo"}
                >
                    <Headphones className="size-3" />
                </Button>
            </div>

            <div className="flex w-full flex-col items-center gap-1 flex-1 justify-center">
                <div className="relative flex h-32 w-4 items-end rounded-full bg-muted/30">
                    <div
                        className="w-full rounded-full transition-all"
                        style={{
                            height: `${track.gain * 100}%`,
                            backgroundColor: track.color,
                            opacity: track.muted ? 0.3 : 0.7,
                        }}
                    />
                </div>
                <span className="text-[9px] font-mono text-muted-foreground">
                    {track.gain === 0 ? "-∞" : `${((track.gain - 0.8) * 40).toFixed(1)}`} dB
                </span>
            </div>

            <div className="w-full">
                <label className="text-[8px] text-muted-foreground block text-center mb-0.5">Pan</label>
                <Slider
                    defaultValue={[track.pan + 50]}
                    max={100}
                    step={1}
                    aria-label={`${track.name} pan`}
                />
            </div>

            <div className="w-full space-y-0.5">
                <label className="text-[8px] text-muted-foreground block text-center">Devices</label>
                {track.devices.length > 0 ? (
                    track.devices.map((d) => (
                        <div key={d.id} className="rounded bg-muted/20 px-1 py-0.5 text-center">
                            <span className="text-[8px] text-muted-foreground">{d.name}</span>
                        </div>
                    ))
                ) : (
                    <div className="rounded bg-muted/10 px-1 py-0.5 text-center">
                        <span className="text-[8px] text-muted-foreground/50">empty</span>
                    </div>
                )}
            </div>
        </div>
    );
};

const ExpandedMasterStrip = (): ReactElement => {
    return (
        <div className="flex w-24 shrink-0 flex-col items-center gap-2 rounded-lg border-l-2 border-foreground/10 bg-surface-overlay p-2 ml-2">
            <div className="h-1 w-full rounded-full bg-foreground/30" />
            <span className="text-xs font-bold text-foreground">Master</span>

            <div className="flex-1 flex flex-col items-center justify-center gap-1">
                <div className="relative flex h-32 w-4 items-end rounded-full bg-muted/30">
                    <div className="w-full rounded-full bg-foreground/50" style={{ height: "80%" }} />
                </div>
                <span className="text-[9px] font-mono text-muted-foreground">0.0 dB</span>
            </div>

            <Slider
                defaultValue={[80]}
                max={100}
                step={1}
                className="w-full"
                aria-label="Master gain"
            />
        </div>
    );
};
