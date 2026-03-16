import { type ReactElement, useState, useSyncExternalStore } from "react";
import { ScrollArea } from "#/components/ui/scroll-area";
import { Slider } from "#/components/ui/slider";
import { Button } from "#/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "#/components/ui/tooltip";
import { Volume2, VolumeX, Headphones, Circle, ChevronDown } from "lucide-react";
import { cn } from "#/helpers/Styles/cn";
import { useTracks } from "#/modules/Track/presentations/hooks/useTracks";
import { muteTrack, soloTrack, selectTrack, setTrackOutput } from "#/modules/Track/useCases/toggleTrackState";
import { setTrackGain, setTrackPan } from "#/modules/Track/useCases/setTrackGainPan";
import { addDevice, removeDevice, setSend, bypassDevice } from "#/modules/Track/useCases/deviceUseCases";
import { armTrack } from "#/modules/Track/useCases/recordingUseCases";
import { audioEngine } from "#/modules/AudioEngine/repositories/audioEngineInstance";
import { transportStore } from "#/modules/Transport/stores/transportStore";
import { workspaceStore } from "#/modules/Workspace/stores/workspaceStore";
import { BUILTIN_PLUGINS } from "#/modules/Track/models/DeviceParameter";
import { useMeterLevel } from "../hooks/useMeterLevel";
import { LevelMeter } from "../components/LevelMeter";
import type { Track } from "#/modules/Track/models/Track";

export const MixView = (): ReactElement => {
    const { tracks, selectedTrackId } = useTracks();

    return (
        <div className="flex h-full flex-col">
            <div className="border-b border-border/50 px-3 py-1.5">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Mixer — {tracks.filter((t) => t.kind !== "folder").length} channels
                </span>
            </div>

            <ScrollArea className="flex-1">
                <div className="flex items-stretch gap-1 p-2 min-h-full">
                    {tracks.filter((t) => t.kind !== "folder").map((track) => (
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
    const { peak, rms, peakHold } = useMeterLevel(track.id);

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
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-pressed={track.muted}
                            className={cn(track.muted && "text-destructive-foreground bg-destructive/20")}
                            onClick={(e) => { e.stopPropagation(); muteTrack(track.id, !track.muted); audioEngine.setTrackMute(track.id, !track.muted); }}
                            aria-label={track.muted ? "Unmute" : "Mute"}
                        >
                            {track.muted ? <VolumeX className="size-3" /> : <Volume2 className="size-3" />}
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>{track.muted ? "Unmute" : "Mute"}</TooltipContent>
                </Tooltip>
                <Tooltip>
                    <TooltipTrigger asChild>
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
                    </TooltipTrigger>
                    <TooltipContent>{track.soloed ? "Unsolo" : "Solo"}</TooltipContent>
                </Tooltip>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-pressed={track.armed}
                            className={cn(track.armed && "text-red-500")}
                            onClick={(e) => { e.stopPropagation(); armTrack(track.id, !track.armed); }}
                            aria-label={track.armed ? "Disarm" : "Arm"}
                        >
                            <Circle className={cn("size-3", track.armed && "fill-red-500")} />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>{track.armed ? "Disarm" : "Arm for recording"}</TooltipContent>
                </Tooltip>
            </div>

            <div className="flex w-full gap-1 flex-1 justify-center items-end">
                <div className="relative flex h-32 w-4 items-end rounded-full bg-muted/30 overflow-hidden">
                    <div
                        className="w-full rounded-full transition-[height] duration-75"
                        style={{
                            height: `${track.gain * 100}%`,
                            backgroundColor: track.color,
                            opacity: track.muted ? 0.3 : 0.7,
                        }}
                    />
                </div>
                <LevelMeter peak={peak} rms={rms} peakHold={peakHold} height="h-32" width="w-2" />
            </div>

            <Slider
                value={[track.gain * 100]}
                onValueChange={([v]) => {
                    if (v !== undefined) {
                        setTrackGain(track.id, v / 100);
                        audioEngine.setTrackGain(track.id, v / 100);
                    }
                }}
                max={100}
                step={1}
                className="w-full"
                aria-label={`${track.name} gain`}
            />
            <span className="text-[9px] font-mono text-muted-foreground">
                {track.gain === 0 ? "-∞" : `${((track.gain - 0.8) * 40).toFixed(1)}`} dB
            </span>

            <div className="w-full">
                <label className="text-[8px] text-muted-foreground block text-center mb-0.5">Pan</label>
                <Slider
                    value={[track.pan + 50]}
                    onValueChange={([v]) => {
                        if (v !== undefined) {
                            setTrackPan(track.id, v - 50);
                            audioEngine.setTrackPan(track.id, v - 50);
                        }
                    }}
                    max={100}
                    step={1}
                    aria-label={`${track.name} pan`}
                />
            </div>

            <DeviceChainSection track={track} />

            <SendsSection track={track} />

            <IOSection track={track} />
        </div>
    );
};

const DeviceChainSection = ({ track }: { track: Track }): ReactElement => {
    const [showAdd, setShowAdd] = useState(false);

    const openInspector = () => {
        selectTrack(track.id);
        const ws = workspaceStore.value;
        if (ws && !ws.inspectorOpen) {
            workspaceStore.set({ ...ws, inspectorOpen: true });
        }
    };

    return (
        <div className="w-full space-y-0.5">
            <label className="text-[8px] text-muted-foreground block text-center">Devices</label>
            {track.devices.map((d) => (
                <div key={d.id} className="group relative">
                    <button
                        className={cn(
                            "w-full rounded bg-muted/20 px-1 py-0.5 text-center hover:bg-muted/40 transition-colors",
                            d.bypassed && "opacity-40 line-through",
                        )}
                        onClick={(e) => { e.stopPropagation(); openInspector(); }}
                        onDoubleClick={(e) => { e.stopPropagation(); bypassDevice(d.id, !d.bypassed); }}
                        title={`${d.name} — click to inspect, double-click to ${d.bypassed ? "enable" : "bypass"}`}
                    >
                        <span className="text-[8px] text-muted-foreground">{d.name}</span>
                    </button>
                    <button
                        className="absolute -right-0.5 -top-0.5 hidden size-3.5 items-center justify-center rounded-full bg-destructive/80 text-[8px] text-destructive-foreground hover:bg-destructive group-hover:flex"
                        onClick={(e) => { e.stopPropagation(); removeDevice(d.id); }}
                        aria-label={`Remove ${d.name}`}
                        title={`Remove ${d.name}`}
                    >
                        ×
                    </button>
                </div>
            ))}
            {showAdd ? (
                <div className="space-y-0.5">
                    {BUILTIN_PLUGINS.map((p) => (
                        <button
                            key={p.id}
                            className="w-full rounded bg-primary/10 px-1 py-0.5 text-center hover:bg-primary/20 text-[8px] text-foreground transition-colors"
                            onClick={(e) => { e.stopPropagation(); addDevice(track.id, p.name); setShowAdd(false); }}
                        >
                            + {p.name}
                        </button>
                    ))}
                    <button
                        className="w-full text-[8px] text-muted-foreground hover:text-foreground"
                        onClick={(e) => { e.stopPropagation(); setShowAdd(false); }}
                    >
                        cancel
                    </button>
                </div>
            ) : (
                <button
                    className="w-full rounded bg-muted/10 px-1 py-0.5 text-center hover:bg-muted/20 transition-colors"
                    onClick={(e) => { e.stopPropagation(); setShowAdd(true); }}
                >
                    <span className="text-[8px] text-muted-foreground/50">+ add</span>
                </button>
            )}
        </div>
    );
};

const SendsSection = ({ track }: { track: Track }): ReactElement => {
    const { tracks } = useTracks();
    const buses = tracks.filter((t) => t.kind === "bus");

    if (buses.length === 0) return <></>;

    return (
        <div className="w-full space-y-0.5">
            <label className="text-[8px] text-muted-foreground block text-center">Sends</label>
            {buses.map((bus) => {
                const send = track.sends.find((s) => s.busId === bus.id);
                const level = send?.level ?? 0;
                return (
                    <div key={bus.id} className="flex items-center gap-1">
                        <span className="text-[7px] text-muted-foreground truncate w-8">{bus.name}</span>
                        <Slider
                            value={[level * 100]}
                            onValueChange={([v]) => {
                                if (v !== undefined) setSend(track.id, bus.id, v / 100);
                            }}
                            max={100}
                            step={1}
                            className="flex-1"
                            aria-label={`Send to ${bus.name}`}
                        />
                    </div>
                );
            })}
        </div>
    );
};

const IOSection = ({ track }: { track: Track }): ReactElement => {
    const [outputOpen, setOutputOpen] = useState(false);
    const { tracks } = useTracks();
    const buses = tracks.filter((t) => t.kind === "bus");

    const inputLabel = track.kind === "midi" ? "MIDI In" : "Default";
    const outputLabel = track.outputId === "master"
        ? "Master"
        : buses.find((b) => b.id === track.outputId)?.name ?? track.outputId;

    const outputTargets: { id: string; label: string }[] = [
        { id: "master", label: "Master" },
        ...buses
            .filter((b) => b.id !== track.id)
            .map((b) => ({ id: b.id, label: b.name })),
    ];

    return (
        <div className="w-full space-y-0.5 border-t border-border/30 pt-1.5 mt-1">
            <label className="text-[8px] text-muted-foreground block text-center">I/O</label>

            <div className="flex items-center justify-between px-0.5">
                <span className="text-[7px] text-muted-foreground/60 uppercase">In</span>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <span className="text-[8px] text-muted-foreground truncate max-w-14 text-right">{inputLabel}</span>
                    </TooltipTrigger>
                    <TooltipContent>Input: {inputLabel}</TooltipContent>
                </Tooltip>
            </div>

            <div className="relative flex items-center justify-between px-0.5">
                <span className="text-[7px] text-muted-foreground/60 uppercase">Out</span>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <button
                            className="flex items-center gap-0.5 rounded px-1 py-0.5 text-[8px] text-foreground hover:bg-muted/30 transition-colors max-w-16 truncate"
                            onClick={(e) => { e.stopPropagation(); setOutputOpen(!outputOpen); }}
                            aria-haspopup="listbox"
                            aria-expanded={outputOpen}
                        >
                            <span className="truncate">{outputLabel}</span>
                            <ChevronDown className="size-2 shrink-0 text-muted-foreground" aria-hidden="true" />
                        </button>
                    </TooltipTrigger>
                    <TooltipContent>Output: {outputLabel}</TooltipContent>
                </Tooltip>

                {outputOpen && (
                    <div
                        className="absolute bottom-full right-0 z-50 mb-1 min-w-20 rounded-md border border-border bg-surface-raised py-1 shadow-lg"
                        role="listbox"
                        aria-label="Output routing"
                    >
                        {outputTargets.map((target) => (
                            <button
                                key={target.id}
                                role="option"
                                aria-selected={track.outputId === target.id}
                                className={cn(
                                    "w-full px-2 py-1 text-left text-[9px] hover:bg-accent transition-colors",
                                    track.outputId === target.id && "text-primary font-medium",
                                )}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setTrackOutput(track.id, target.id);
                                    setOutputOpen(false);
                                }}
                            >
                                {target.label}
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

const ExpandedMasterStrip = (): ReactElement => {
    const { peak, rms, peakHold } = useMeterLevel(null);
    const masterGain = useSyncExternalStore(
        (cb) => transportStore.subscribe(cb),
        () => transportStore.value?.masterGain ?? 80,
    );

    const setMasterGain = (v: number) => {
        const state = transportStore.value;
        if (state) {
            transportStore.set({ ...state, masterGain: v });
        }
        audioEngine.setMasterGain(v / 100);
    };

    return (
        <div className="flex w-24 shrink-0 flex-col items-center gap-2 rounded-lg border-l-2 border-foreground/10 bg-surface-overlay p-2 ml-2">
            <div className="h-1 w-full rounded-full bg-foreground/30" />
            <span className="text-xs font-bold text-foreground">Master</span>

            <div className="flex-1 flex gap-1 items-end justify-center">
                <div className="relative flex h-32 w-4 items-end rounded-full bg-muted/30 overflow-hidden">
                    <div className="w-full rounded-full bg-foreground/50" style={{ height: `${masterGain}%` }} />
                </div>
                <LevelMeter peak={peak} rms={rms} peakHold={peakHold} height="h-32" width="w-2" />
            </div>

            <span className="text-[9px] font-mono text-muted-foreground">
                {masterGain === 0 ? "-∞" : `${((masterGain / 80 - 1) * 12).toFixed(1)} dB`}
            </span>

            <Slider
                value={[masterGain]}
                onValueChange={([v]) => {
                    if (v !== undefined) {
                        setMasterGain(v);
                    }
                }}
                max={100}
                step={1}
                className="w-full"
                aria-label="Master gain"
            />
        </div>
    );
};
