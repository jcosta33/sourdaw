import { type CSSProperties, type ReactElement, type MouseEvent as ReactMouseEvent, useState, useSyncExternalStore, useRef, useEffect } from "react";
import { ScrollArea } from "#/components/ui/scroll-area";
import { Button } from "#/components/ui/button";
import { Slider } from "#/components/ui/slider";
import { Volume2, VolumeX, Headphones, Circle, Ear, Columns3, ShieldCheck } from "lucide-react";
import { cn } from "#/helpers/Styles/cn";
import { useTracks } from "#/modules/Track/presentations/hooks/useTracks";
import { muteTrack, soloTrack, soloTrackExclusive, selectTrack, toggleInputMonitoring, toggleSoloSafe } from "#/modules/Track/useCases/toggleTrackState";
import { setTrackGain, setTrackPan, setTrackColor } from "#/modules/Track/useCases/setTrackGainPan";
import { setSend, toggleSendPreFader, bypassDevice, addDevice, reorderDevices } from "#/modules/Track/useCases/deviceUseCases";
import { armTrack } from "#/modules/Track/useCases/recordingUseCases";
import { removeTrack } from "#/modules/Track/useCases/removeTrack";
import { renameTrack } from "#/modules/Track/useCases/renameTrack";
import { audioEngine } from "#/modules/AudioEngine/repositories/audioEngineInstance";
import { transportStore } from "#/modules/Transport/stores/transportStore";
import { useMeterLevel } from "../hooks/useMeterLevel";
import { LevelMeter } from "./LevelMeter";
import { useWorkspaceState } from "../hooks/useWorkspaceState";
import { workspaceStore } from "#/modules/Workspace/stores/workspaceStore";
import type { ChannelStripWidth } from "#/modules/Workspace/models/WorkspaceState";
import type { Track } from "#/modules/Track/models/Track";

type MixerPanelProps = {
    style?: CSSProperties;
};

const STRIP_WIDTH_CLASS: Record<ChannelStripWidth, string> = {
    narrow: "w-12",
    normal: "w-16",
    wide: "w-24",
};

const STRIP_WIDTH_CYCLE: Record<ChannelStripWidth, ChannelStripWidth> = {
    narrow: "normal",
    normal: "wide",
    wide: "narrow",
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
            <div className="flex items-center justify-between border-b border-border/50 px-3 py-1.5">
                <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Mixer
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
                <div className="flex h-full items-stretch gap-px p-1">
                    {tracks.filter((t) => t.kind !== "folder").map((track) => (
                        <ChannelStrip
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

type MixerMenu = { x: number; y: number } | null;

const DEVICE_TYPES = [
    { type: "EQ", label: "EQ" },
    { type: "Compressor", label: "Compressor" },
    { type: "Reverb", label: "Reverb" },
    { type: "Delay", label: "Delay" },
    { type: "Gain", label: "Gain" },
] as const;

const TRACK_COLORS = ["", "#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899"];

const ChannelStrip = ({ track, isSelected, widthClass }: { track: Track; isSelected: boolean; widthClass: string }): ReactElement => {
    const { peak, rms, peakHold } = useMeterLevel(track.id);
    const [ctxMenu, setCtxMenu] = useState<MixerMenu>(null);
    const [isRenaming, setIsRenaming] = useState(false);
    const ctxRef = useRef<HTMLDivElement>(null);
    const renameRef = useRef<HTMLInputElement>(null);

    const handleContextMenu = (e: ReactMouseEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setCtxMenu({ x: e.clientX, y: e.clientY });
    };

    useEffect(() => {
        if (!ctxMenu) {
            return;
        }
        const dismiss = (e: MouseEvent) => {
            if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) {
                setCtxMenu(null);
            }
        };
        const esc = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                setCtxMenu(null);
            }
        };
        document.addEventListener("mousedown", dismiss);
        document.addEventListener("keydown", esc);
        return () => {
            document.removeEventListener("mousedown", dismiss);
            document.removeEventListener("keydown", esc);
        };
    }, [ctxMenu]);

    useEffect(() => {
        if (isRenaming) {
            renameRef.current?.focus();
            renameRef.current?.select();
        }
    }, [isRenaming]);

    const act = (fn: () => void) => () => { fn(); setCtxMenu(null); };

    return (
        <div
            className={cn(
                "flex shrink-0 flex-col items-center gap-1 rounded px-1 py-1.5",
                widthClass,
                "bg-surface-overlay",
                isSelected && "ring-1 ring-ring",
            )}
            onClick={() => selectTrack(track.id)}
            onContextMenu={handleContextMenu}
            role="group"
            aria-label={`${track.name} channel`}
        >
            <div className="flex flex-wrap justify-center gap-0.5">
                <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={track.muted ? "Unmute" : "Mute"}
                    aria-pressed={track.muted}
                    className={cn("size-5", track.muted && "text-destructive-foreground")}
                    onClick={(e) => { e.stopPropagation(); muteTrack(track.id, !track.muted); audioEngine.setTrackMute(track.id, !track.muted); }}
                >
                    {track.muted ? <VolumeX className="size-2.5" /> : <Volume2 className="size-2.5" />}
                </Button>
                <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={track.soloed ? "Unsolo" : "Solo"}
                    aria-pressed={track.soloed}
                    className={cn("size-5", track.soloed && "text-yellow-400")}
                    onClick={(e) => {
                        e.stopPropagation();
                        if (e.metaKey || e.ctrlKey) {
                            soloTrack(track.id, !track.soloed);
                        } else {
                            soloTrackExclusive(track.id);
                        }
                    }}
                >
                    <Headphones className="size-2.5" />
                </Button>
                <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={track.armed ? "Disarm" : "Arm"}
                    aria-pressed={track.armed}
                    className={cn("size-5", track.armed && "text-red-500")}
                    onClick={(e) => { e.stopPropagation(); armTrack(track.id, !track.armed); }}
                >
                    <Circle className={cn("size-2.5", track.armed && "fill-red-500")} />
                </Button>
                {track.kind === "audio" && (
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={track.inputMonitoring === "on" ? "Disable input monitoring" : "Enable input monitoring"}
                        aria-pressed={track.inputMonitoring === "on"}
                        className={cn("size-5", track.inputMonitoring === "on" && "text-green-400")}
                        onClick={(e) => { e.stopPropagation(); toggleInputMonitoring(track.id); }}
                    >
                        <Ear className={cn("size-2.5", track.inputMonitoring === "on" && "fill-green-400/30")} />
                    </Button>
                )}
                {track.soloSafe && (
                    <ShieldCheck className="size-2.5 text-cyan-400" aria-label="Solo safe" />
                )}
            </div>

            <div className="flex gap-0.5 h-full items-end">
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
                <LevelMeter peak={peak} rms={rms} peakHold={peakHold} width="w-1.5" />
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
                className="w-12"
                aria-label={`${track.name} gain`}
            />

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
                className="w-12"
                aria-label={`${track.name} pan`}
            />

            {track.devices.length > 0 && (
                <div className="w-full space-y-px">
                    {track.devices.map((d, deviceIndex) => (
                        <button
                            key={d.id}
                            className={cn("w-full rounded bg-muted/20 px-0.5 py-px text-center text-[7px] text-muted-foreground hover:bg-muted/30 cursor-grab active:cursor-grabbing", d.bypassed && "opacity-40 line-through")}
                            onClick={(e) => { e.stopPropagation(); bypassDevice(d.id, !d.bypassed); }}
                            title={d.bypassed ? "Enable" : "Bypass"}
                            draggable
                            onDragStart={(e) => {
                                e.dataTransfer.setData("text/plain", String(deviceIndex));
                                e.dataTransfer.effectAllowed = "move";
                            }}
                            onDragOver={(e) => {
                                e.preventDefault();
                                e.dataTransfer.dropEffect = "move";
                            }}
                            onDrop={(e) => {
                                e.preventDefault();
                                const fromIndex = parseInt(e.dataTransfer.getData("text/plain"), 10);
                                if (!isNaN(fromIndex) && fromIndex !== deviceIndex) {
                                    reorderDevices(track.id, fromIndex, deviceIndex);
                                }
                            }}
                        >
                            <span className="text-[6px] text-muted-foreground/50 mr-0.5">≡</span>{d.name}
                        </button>
                    ))}
                </div>
            )}

            <MiniSends track={track} />

            <div
                className="h-0.5 w-8 rounded-full"
                style={{ backgroundColor: track.color }}
            />

            {isRenaming ? (
                <input
                    ref={renameRef}
                    defaultValue={track.name}
                    className="w-full rounded border border-border bg-surface-base px-0.5 text-center text-[9px] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    onBlur={(e) => { renameTrack(track.id, e.currentTarget.value); setIsRenaming(false); }}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            renameTrack(track.id, e.currentTarget.value);
                            setIsRenaming(false);
                        }
                        if (e.key === "Escape") {
                            setIsRenaming(false);
                        }
                    }}
                />
            ) : (
                <span className="w-full truncate text-center text-[9px] text-muted-foreground" onDoubleClick={() => setIsRenaming(true)}>
                    {track.name}
                </span>
            )}

            {ctxMenu && (
                <div
                    ref={ctxRef}
                    className="fixed z-50 min-w-[160px] rounded-md border border-border bg-popover py-1 shadow-lg"
                    style={{ left: ctxMenu.x, top: ctxMenu.y }}
                    role="menu"
                >
                    <button className="flex w-full items-center px-3 py-1.5 text-xs hover:bg-accent" role="menuitem" onClick={act(() => muteTrack(track.id, !track.muted))}>
                        {track.muted ? "Unmute" : "Mute"}
                    </button>
                    <button className="flex w-full items-center px-3 py-1.5 text-xs hover:bg-accent" role="menuitem" onClick={act(() => soloTrack(track.id, !track.soloed))}>
                        {track.soloed ? "Unsolo" : "Solo"}
                    </button>
                    <button className="flex w-full items-center px-3 py-1.5 text-xs hover:bg-accent" role="menuitem" onClick={act(() => toggleSoloSafe(track.id))}>
                        {track.soloSafe ? "Disable Solo Safe" : "Solo Safe"}
                    </button>
                    <button className="flex w-full items-center px-3 py-1.5 text-xs hover:bg-accent" role="menuitem" onClick={act(() => armTrack(track.id, !track.armed))}>
                        {track.armed ? "Disarm" : "Arm for Recording"}
                    </button>
                    <div className="my-1 border-t border-border/50" />
                    <button className="flex w-full items-center px-3 py-1.5 text-xs hover:bg-accent" role="menuitem" onClick={act(() => setIsRenaming(true))}>
                        Rename…
                    </button>
                    <div className="my-1 border-t border-border/50" />
                    <div className="px-3 py-1 text-[10px] text-muted-foreground">Add Effect</div>
                    {DEVICE_TYPES.map((d) => (
                        <button key={d.type} className="flex w-full items-center px-3 py-1.5 text-xs hover:bg-accent pl-5" role="menuitem" onClick={act(() => addDevice(track.id, d.type))}>
                            {d.label}
                        </button>
                    ))}
                    <div className="my-1 border-t border-border/50" />
                    <div className="px-3 py-1 text-[10px] text-muted-foreground">Color</div>
                    <div className="flex gap-1 px-3 py-1">
                        {TRACK_COLORS.map((c) => (
                            <button
                                key={c || "default"}
                                className="size-3.5 rounded-full border border-border/50 hover:ring-1 hover:ring-foreground/30"
                                style={{ backgroundColor: c || "var(--color-muted)" }}
                                onClick={act(() => setTrackColor(track.id, c))}
                                aria-label={c || "Default color"}
                            />
                        ))}
                    </div>
                    <div className="my-1 border-t border-border/50" />
                    <button className="flex w-full items-center px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10" role="menuitem" onClick={act(() => removeTrack(track.id))}>
                        Remove Channel
                    </button>
                </div>
            )}
        </div>
    );
};

const MiniSends = ({ track }: { track: Track }): ReactElement | null => {
    const { tracks } = useTracks();
    const buses = tracks.filter((t) => t.kind === "bus");
    if (buses.length === 0) {
        return null;
    }

    return (
        <div className="w-full space-y-px">
            {buses.map((bus) => {
                const send = track.sends.find((s) => s.busId === bus.id);
                const level = send?.level ?? 0;
                const isPreFader = send?.preFader ?? false;
                return (
                    <div key={bus.id} className="flex items-center gap-0.5">
                        <span className="text-[6px] text-muted-foreground truncate w-5">{bus.name}</span>
                        <Slider
                            value={[level * 100]}
                            onValueChange={([v]) => {
                                if (v !== undefined) {
                                    setSend(track.id, bus.id, v / 100);
                                }
                            }}
                            max={100}
                            step={1}
                            className="flex-1"
                            aria-label={`Send to ${bus.name}`}
                        />
                        <button
                            className={cn(
                                "shrink-0 rounded px-0.5 text-[5px] font-bold leading-tight",
                                isPreFader
                                    ? "bg-yellow-500/20 text-yellow-400"
                                    : "bg-muted/20 text-muted-foreground hover:bg-muted/30",
                            )}
                            onClick={(e) => {
                                e.stopPropagation();
                                toggleSendPreFader(track.id, bus.id);
                            }}
                            aria-label={`Toggle send to ${bus.name} ${isPreFader ? "post" : "pre"}-fader`}
                            title={isPreFader ? "Pre-fader (click for post)" : "Post-fader (click for pre)"}
                        >
                            {isPreFader ? "PRE" : "POST"}
                        </button>
                    </div>
                );
            })}
        </div>
    );
};

const MasterChannelStrip = ({ widthClass }: { widthClass: string }): ReactElement => {
    const masterGain = useSyncExternalStore(
        (cb) => transportStore.subscribe(cb),
        () => transportStore.value?.masterGain ?? 80,
    );
    const { peak, rms, peakHold } = useMeterLevel(null);

    const setMasterGain = (v: number) => {
        const state = transportStore.value;
        if (state) {
            transportStore.set({ ...state, masterGain: v });
        }
        audioEngine.setMasterGain(v / 100);
    };

    return (
        <div
            className={cn("flex shrink-0 flex-col items-center gap-1 rounded bg-surface-overlay px-1 py-1.5 ml-1 border-l border-border/30", widthClass)}
            role="group"
            aria-label="Master channel"
        >
            <span className="text-[9px] font-medium text-muted-foreground">MASTER</span>

            <div className="flex gap-0.5 h-full items-end">
                <div className="relative flex h-full w-3 items-end rounded-full bg-muted/30">
                    <div className="w-full rounded-full bg-foreground/50" style={{ height: `${masterGain}%` }} />
                </div>
                <LevelMeter peak={peak} rms={rms} peakHold={peakHold} width="w-1.5" />
            </div>

            <Slider
                value={[masterGain]}
                onValueChange={([v]) => {
                    if (v !== undefined) {
                        setMasterGain(v);
                    }
                }}
                max={100}
                step={1}
                className="w-12"
                aria-label="Master gain"
            />

            <span className="text-[9px] font-mono text-muted-foreground">
                {masterGain === 0 ? "-∞" : `${((masterGain / 80 - 1) * 12).toFixed(1)} dB`}
            </span>
        </div>
    );
};
