import { type CSSProperties, type ReactElement, useState, useSyncExternalStore } from "react";
import { ScrollArea } from "#/components/ui/scroll-area";
import { Slider } from "#/components/ui/slider";
import { Input } from "#/components/ui/input";
import { Button } from "#/components/ui/button";
import { Separator } from "#/components/ui/separator";
import { Eye, EyeOff, Plus, Trash2, Power, Snowflake, Zap, ChevronRight, ChevronDown } from "lucide-react";
import { cn } from "#/helpers/Styles/cn";
import { useTracks } from "#/modules/Track/presentations/hooks/useTracks";
import { renameTrack } from "#/modules/Track/useCases/renameTrack";
import { setTrackNotes } from "#/modules/Track/useCases/setTrackGainPan";
import { trimClipStart, trimClipEnd, setClipFade, setClipGain, setClipColor, renameClip } from "#/modules/Track/useCases/clipEditingUseCases";
import { BUILTIN_PLUGINS, type DeviceParameter } from "#/modules/Track/models/DeviceParameter";
import { addAutomationLane as addAutoLane } from "#/modules/Track/useCases/automationUseCases";
import type { Clip, Device } from "#/modules/Track/models/Track";
import { setTrackGain, setTrackPan, setTrackColor } from "#/modules/Track/useCases/setTrackGainPan";
import { bypassDevice, removeDevice, addDevice, setDeviceParameter, setSend, toggleSendPreFader, reorderDevices } from "#/modules/Track/useCases/deviceUseCases";
import { addAutomationLane, toggleAutomationVisibility, removeAutomationLane } from "#/modules/Track/useCases/automationUseCases";
import { freezeTrack, unfreezeTrack } from "#/modules/Track/useCases/freezeBounce";
import { automationStore } from "#/modules/Track/stores/automationStore";
import { takeLaneStore } from "#/modules/Track/stores/takeLaneStore";
import { setCompRegion, selectTake, flattenComp } from "#/modules/Track/useCases/compingUseCases";
import { audioGraphStore } from "#/modules/AudioEngine/stores/audioGraphStore";
import { getSidechainSource, addSidechainRoute, removeSidechainRoute } from "#/modules/AudioEngine/useCases/sidechainUseCases";
import { workspaceStore } from "#/modules/Workspace/stores/workspaceStore";
import { RoutingGraph } from "./RoutingGraph";
import { MidiLearnButton } from "#/modules/Track/presentations/components/MidiLearnButton";
import type { Track } from "#/modules/Track/models/Track";

const TRACK_COLOR_PRESETS = [
    "oklch(0.65 0.15 145)",
    "oklch(0.65 0.15 260)",
    "oklch(0.65 0.15 50)",
    "oklch(0.65 0.15 0)",
    "oklch(0.65 0.15 320)",
    "oklch(0.65 0.15 180)",
    "oklch(0.65 0.15 90)",
    "oklch(0.65 0.15 30)",
];

const CLIP_COLOR_PRESETS = ["", "#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899"];

type InspectorPanelProps = {
    style?: CSSProperties;
};

export const InspectorPanel = ({ style }: InspectorPanelProps): ReactElement => {
    const { tracks, selectedTrackId } = useTracks();
    const selectedTrack = tracks.find((t) => t.id === selectedTrackId);
    const wsSelectedClipId = useSyncExternalStore(
        (cb) => workspaceStore.subscribe(cb),
        () => workspaceStore.value?.selectedClipId ?? null,
    );
    const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

    const selectedClip = selectedTrack?.clips.find((c) => c.id === wsSelectedClipId) ?? null;
    const selectedDevice = selectedTrack?.devices.find((d) => d.id === selectedDeviceId) ?? null;

    return (
        <aside
            className="flex shrink-0 flex-col border-l border-border/50 bg-surface-raised"
            style={style}
            aria-label="Inspector panel"
        >
            <div className="border-b border-border/50 px-3 py-2">
                <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Inspector
                </h2>
            </div>

            <ScrollArea className="flex-1">
                {selectedDevice && selectedTrack ? (
                    <DeviceInspector device={selectedDevice} trackId={selectedTrack.id} onBack={() => setSelectedDeviceId(null)} />
                ) : selectedClip && selectedTrack ? (
                    <ClipInspector clip={selectedClip} trackId={selectedTrack.id} onBack={() => {
                        const ws = workspaceStore.value;
                        if (ws) {
                            workspaceStore.set({ ...ws, selectedClipId: null, selectedClipIds: [] });
                        }
                    }} />
                ) : selectedTrack ? (
                    <TrackInspector track={selectedTrack} onSelectClip={(id) => {
                        const ws = workspaceStore.value;
                        if (ws) {
                            workspaceStore.set({ ...ws, selectedClipId: id, selectedClipIds: [id] });
                        }
                    }} onSelectDevice={setSelectedDeviceId} />
                ) : (
                    <div className="p-3">
                        <p className="text-xs text-muted-foreground">
                            Select a track, clip, or device to inspect its properties.
                        </p>
                    </div>
                )}
            </ScrollArea>
        </aside>
    );
};

const TrackInspector = ({ track, onSelectClip, onSelectDevice }: { track: Track; onSelectClip: (id: string) => void; onSelectDevice: (id: string) => void }): ReactElement => {
    const [editingName, setEditingName] = useState(false);
    const [nameValue, setNameValue] = useState(track.name);
    const [notesValue, setNotesValue] = useState(track.notes);

    const autoState = useSyncExternalStore(
        (cb) => automationStore.subscribe(cb),
        () => automationStore.value,
    );

    const graphState = useSyncExternalStore(
        (cb) => audioGraphStore.subscribe(cb),
        () => audioGraphStore.value,
    );

    const trackLanes = autoState?.lanes.filter((l) => l.trackId === track.id) ?? [];
    const trackRoutes = graphState?.routes.filter((r) => r.sourceId === track.id || r.destinationId === track.id) ?? [];

    const commitName = () => {
        if (nameValue.trim() && nameValue !== track.name) {
            renameTrack(track.id, nameValue.trim());
        }
        setEditingName(false);
    };

    return (
        <div className="space-y-4 p-3">
            <section>
                <h3 className="mb-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    Track
                </h3>

                <div className="space-y-2">
                    <div>
                        <label className="text-[10px] text-muted-foreground">Name</label>
                        {editingName ? (
                            <Input
                                value={nameValue}
                                onChange={(e) => setNameValue(e.target.value)}
                                onBlur={commitName}
                                onKeyDown={(e) => { if (e.key === "Enter") commitName(); }}
                                className="h-7 text-xs"
                                autoFocus
                            />
                        ) : (
                            <Button
                                variant="ghost"
                                size="xs"
                                className="w-full justify-start font-normal"
                                onClick={() => { setEditingName(true); setNameValue(track.name); }}
                            >
                                {track.name}
                            </Button>
                        )}
                    </div>

                    <div className="flex items-center gap-2">
                        <label className="text-[10px] text-muted-foreground w-8">Kind</label>
                        <span className="text-xs text-foreground capitalize">{track.kind}</span>
                    </div>

                    <div className="flex items-center gap-2">
                        <label className="text-[10px] text-muted-foreground w-8">Color</label>
                        <div className="flex gap-1">
                            {TRACK_COLOR_PRESETS.map((c) => (
                                <button
                                    key={c}
                                    className="size-4 rounded border border-border transition-transform hover:scale-125"
                                    style={{ backgroundColor: c, outline: c === track.color ? "2px solid white" : "none", outlineOffset: "1px" }}
                                    onClick={() => setTrackColor(track.id, c)}
                                    aria-label={`Set color`}
                                />
                            ))}
                        </div>
                    </div>

                    {track.kind !== "folder" && (
                        <div className="flex items-center gap-1">
                            <Button
                                variant={track.frozen ? "secondary" : "ghost"}
                                size="xs"
                                onClick={() => track.frozen ? unfreezeTrack(track.id) : freezeTrack(track.id)}
                                aria-pressed={track.frozen}
                            >
                                {track.frozen ? <Zap className="size-3 mr-1" /> : <Snowflake className="size-3 mr-1" />}
                                {track.frozen ? "Unfreeze" : "Freeze"}
                            </Button>
                        </div>
                    )}

                    <div>
                        <label className="text-[10px] text-muted-foreground">Notes</label>
                        <textarea
                            className="mt-1 w-full rounded border border-border bg-surface-overlay px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring resize-y"
                            rows={2}
                            placeholder="Add notes…"
                            value={notesValue}
                            onChange={(e) => setNotesValue(e.target.value)}
                            onBlur={() => {
                                if (notesValue !== track.notes) {
                                    setTrackNotes(track.id, notesValue);
                                }
                            }}
                            aria-label={`Notes for ${track.name}`}
                        />
                    </div>
                </div>
            </section>

            <Separator />

            <section>
                <h3 className="mb-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    Level
                </h3>

                <div className="space-y-3">
                    <div>
                        <div className="flex items-center justify-between mb-1">
                            <label className="text-[10px] text-muted-foreground">Gain</label>
                            <div className="flex items-center gap-1">
                                <span className="text-[10px] font-mono text-muted-foreground">{(track.gain * 100).toFixed(0)}%</span>
                                <MidiLearnButton targetType="trackGain" trackId={track.id} />
                            </div>
                        </div>
                        <Slider
                            value={[track.gain * 100]}
                            onValueChange={([v]) => { if (v !== undefined) setTrackGain(track.id, v / 100); }}
                            max={100}
                            step={1}
                            aria-label={`${track.name} gain`}
                        />
                    </div>

                    <div>
                        <div className="flex items-center justify-between mb-1">
                            <label className="text-[10px] text-muted-foreground">Pan</label>
                            <div className="flex items-center gap-1">
                                <span className="text-[10px] font-mono text-muted-foreground">{track.pan === 0 ? "C" : track.pan > 0 ? `R${track.pan}` : `L${Math.abs(track.pan)}`}</span>
                                <MidiLearnButton targetType="trackPan" trackId={track.id} />
                            </div>
                        </div>
                        <Slider
                            value={[track.pan + 50]}
                            onValueChange={([v]) => { if (v !== undefined) setTrackPan(track.id, v - 50); }}
                            max={100}
                            step={1}
                            aria-label={`${track.name} pan`}
                        />
                    </div>
                </div>
            </section>

            <Separator />

            <section>
                <div className="flex items-center justify-between mb-2">
                    <h3 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                        Devices
                    </h3>
                    <Button variant="ghost" size="icon-xs" onClick={() => addDevice(track.id, "EQ")} aria-label="Add device">
                        <Plus className="size-3" />
                    </Button>
                </div>
                {track.devices.length > 0 ? (
                    <div className="space-y-1">
                        {track.devices.map((device, deviceIndex) => (
                            <div
                                key={device.id}
                                className="flex items-center justify-between rounded bg-surface-overlay px-2 py-1.5 cursor-grab active:cursor-grabbing hover:bg-accent/50"
                                onClick={() => onSelectDevice(device.id)}
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
                                <div className="flex items-center gap-1">
                                    <span className="text-[10px] text-muted-foreground/50 select-none">≡</span>
                                    <span className="text-xs text-foreground">{device.name}</span>
                                </div>
                                <div className="flex gap-0.5">
                                    <Button
                                        variant="ghost"
                                        size="icon-xs"
                                        aria-label={`${device.bypassed ? "Enable" : "Bypass"} ${device.name}`}
                                        aria-pressed={device.bypassed}
                                        onClick={(e) => { e.stopPropagation(); bypassDevice(device.id, !device.bypassed); }}
                                    >
                                        <Power className={`size-3 ${device.bypassed ? "text-muted-foreground" : "text-emerald-400"}`} />
                                    </Button>
                                    <Button variant="ghost" size="icon-xs" aria-label={`Remove ${device.name}`} onClick={(e) => { e.stopPropagation(); removeDevice(device.id); }}>
                                        <Trash2 className="size-3 text-muted-foreground" />
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <p className="text-[10px] text-muted-foreground">No devices. Click + to add.</p>
                )}
            </section>

            <Separator />

            <section>
                <div className="flex items-center justify-between mb-2">
                    <h3 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                        Automation
                    </h3>
                    <Button variant="ghost" size="icon-xs" onClick={() => addAutomationLane(track.id, "gain", "Gain")} aria-label="Add automation lane">
                        <Plus className="size-3" />
                    </Button>
                </div>
                {trackLanes.length > 0 ? (
                    <div className="space-y-1">
                        {trackLanes.map((lane) => (
                            <div key={lane.id} className="flex items-center justify-between rounded bg-surface-overlay px-2 py-1.5">
                                <span className="text-xs text-foreground">{lane.parameterName}</span>
                                <div className="flex gap-0.5">
                                    <Button variant="ghost" size="icon-xs" aria-label={lane.visible ? "Hide" : "Show"} onClick={() => toggleAutomationVisibility(lane.id)}>
                                        {lane.visible ? <Eye className="size-3" /> : <EyeOff className="size-3 text-muted-foreground" />}
                                    </Button>
                                    <Button variant="ghost" size="icon-xs" aria-label="Remove lane" onClick={() => removeAutomationLane(lane.id)}>
                                        <Trash2 className="size-3 text-muted-foreground" />
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <p className="text-[10px] text-muted-foreground">No automation lanes.</p>
                )}
            </section>

            <Separator />

            <SendsEditor track={track} />

            <Separator />

            <section>
                <h3 className="mb-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    Routing
                </h3>
                {trackRoutes.length > 0 ? (
                    <div className="space-y-1">
                        {trackRoutes.map((route) => (
                            <div key={route.id} className="flex items-center justify-between rounded bg-surface-overlay px-2 py-1">
                                <span className="text-[10px] text-muted-foreground">
                                    {route.sourceId === track.id ? `→ ${route.destinationId}` : `← ${route.sourceId}`}
                                </span>
                                <span className="text-[10px] font-mono text-muted-foreground">{(route.gain * 100).toFixed(0)}%</span>
                            </div>
                        ))}
                    </div>
                ) : (
                    <p className="text-[10px] text-muted-foreground">Default routing to master.</p>
                )}
            </section>

            <Separator />

            <section>
                <h3 className="mb-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    Clips ({track.clips.length})
                </h3>
                {track.clips.length > 0 ? (
                    <div className="space-y-1">
                        {track.clips.map((clip) => (
                            <div key={clip.id} className="rounded bg-surface-overlay px-2 py-1.5 cursor-pointer hover:bg-accent/50" onClick={() => onSelectClip(clip.id)}>
                                <span className="text-xs text-foreground">{clip.name}</span>
                                <span className="ml-1 text-[10px] text-muted-foreground">
                                    bar {Math.floor(clip.startBeat / 4) + 1}–{Math.floor(clip.endBeat / 4) + 1}
                                </span>
                            </div>
                        ))}
                    </div>
                ) : (
                    <p className="text-[10px] text-muted-foreground">No clips on this track.</p>
                )}
            </section>

            <TakesSection trackId={track.id} />

            <Separator />

            <SignalFlowSection />
        </div>
    );
};

const TakesSection = ({ trackId }: { trackId: string }): ReactElement | null => {
    const takeLaneState = useSyncExternalStore(
        (cb) => takeLaneStore.subscribe(cb),
        () => takeLaneStore.value,
    );

    const lane = takeLaneState?.lanes.find((l) => l.trackId === trackId);
    if (!lane || lane.takes.length === 0) return null;

    const handleSetActive = (takeId: string) => {
        const take = lane.takes.find((t) => t.id === takeId);
        if (!take) return;
        selectTake(trackId, takeId);
        setCompRegion(trackId, {
            takeId,
            startBeat: take.startBeat,
            endBeat: take.endBeat,
        });
    };

    return (
        <>
            <Separator />
            <section>
                <div className="flex items-center justify-between mb-2">
                    <h3 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                        Takes ({lane.takes.length})
                    </h3>
                    <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => flattenComp(trackId)}
                        aria-label="Flatten comp"
                    >
                        Flatten
                    </Button>
                </div>
                <div className="space-y-1">
                    {lane.takes.map((take) => (
                        <div
                            key={take.id}
                            className={cn(
                                "flex items-center justify-between rounded px-2 py-1.5",
                                take.selected
                                    ? "bg-primary/15 ring-1 ring-primary/30"
                                    : "bg-surface-overlay",
                            )}
                        >
                            <div className="min-w-0 flex-1">
                                <span className="text-xs text-foreground truncate block">{take.name}</span>
                                <span className="text-[10px] text-muted-foreground">
                                    beat {take.startBeat}–{take.endBeat}
                                </span>
                            </div>
                            {!take.selected && (
                                <Button
                                    variant="ghost"
                                    size="xs"
                                    onClick={() => handleSetActive(take.id)}
                                    aria-label={`Set ${take.name} as active take`}
                                >
                                    Set Active
                                </Button>
                            )}
                            {take.selected && (
                                <span className="text-[10px] font-medium text-primary">Active</span>
                            )}
                        </div>
                    ))}
                </div>
            </section>
        </>
    );
};

const SignalFlowSection = (): ReactElement => {
    const [expanded, setExpanded] = useState(false);

    return (
        <section>
            <button
                className="flex w-full items-center gap-1 mb-2"
                onClick={() => { setExpanded(!expanded); }}
                aria-expanded={expanded}
            >
                {expanded
                    ? <ChevronDown className="size-3 text-muted-foreground" />
                    : <ChevronRight className="size-3 text-muted-foreground" />}
                <h3 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    Signal Flow
                </h3>
            </button>
            {expanded && (
                <div className="rounded bg-surface-overlay p-1">
                    <RoutingGraph />
                </div>
            )}
        </section>
    );
};

const ClipInspector = ({ clip, onBack }: { clip: Clip; trackId: string; onBack: () => void }): ReactElement => {
    const duration = clip.endBeat - clip.startBeat;
    const startBar = Math.floor(clip.startBeat / 4) + 1;
    const endBar = Math.floor(clip.endBeat / 4) + 1;
    const [editingName, setEditingName] = useState(false);
    const [nameValue, setNameValue] = useState(clip.name);

    const commitClipName = () => {
        const trimmed = nameValue.trim();
        if (trimmed && trimmed !== clip.name) {
            renameClip(clip.id, trimmed);
        }
        setEditingName(false);
    };

    return (
        <div className="space-y-4 p-3">
            <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon-xs" onClick={onBack} aria-label="Back to track">
                    <ChevronRight className="size-3 rotate-180" />
                </Button>
                {editingName ? (
                    <Input
                        value={nameValue}
                        onChange={(e) => setNameValue(e.target.value)}
                        onBlur={commitClipName}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                commitClipName();
                            }
                            if (e.key === "Escape") {
                                setNameValue(clip.name);
                                setEditingName(false);
                            }
                        }}
                        className="h-6 flex-1 text-xs"
                        aria-label={`Rename clip ${clip.name}`}
                        autoFocus
                    />
                ) : (
                    <h3
                        className="text-xs font-medium text-foreground cursor-pointer hover:underline"
                        onDoubleClick={() => { setNameValue(clip.name); setEditingName(true); }}
                        title="Double-click to rename"
                    >
                        {clip.name}
                    </h3>
                )}
            </div>

            <section>
                <h3 className="mb-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    Position
                </h3>
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <label className="text-[10px] text-muted-foreground">Start</label>
                        <span className="text-[10px] font-mono text-foreground">Bar {startBar} (beat {clip.startBeat})</span>
                    </div>
                    <div className="flex items-center justify-between">
                        <label className="text-[10px] text-muted-foreground">End</label>
                        <span className="text-[10px] font-mono text-foreground">Bar {endBar} (beat {clip.endBeat})</span>
                    </div>
                    <div className="flex items-center justify-between">
                        <label className="text-[10px] text-muted-foreground">Length</label>
                        <span className="text-[10px] font-mono text-foreground">{duration} beats ({(duration / 4).toFixed(1)} bars)</span>
                    </div>
                </div>
            </section>

            <Separator />

            <section>
                <h3 className="mb-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    Trim
                </h3>
                <div className="space-y-2">
                    <div>
                        <div className="flex items-center justify-between mb-1">
                            <label className="text-[10px] text-muted-foreground">Trim Start</label>
                        </div>
                        <Slider
                            value={[clip.startBeat]}
                            onValueChange={([v]) => { if (v !== undefined) trimClipStart(clip.id, v); }}
                            max={clip.endBeat - 1}
                            step={0.25}
                            aria-label="Trim clip start"
                        />
                    </div>
                    <div>
                        <div className="flex items-center justify-between mb-1">
                            <label className="text-[10px] text-muted-foreground">Trim End</label>
                        </div>
                        <Slider
                            value={[clip.endBeat]}
                            onValueChange={([v]) => { if (v !== undefined) trimClipEnd(clip.id, v); }}
                            min={clip.startBeat + 1}
                            max={clip.startBeat + 256}
                            step={0.25}
                            aria-label="Trim clip end"
                        />
                    </div>
                </div>
            </section>

            <Separator />

            <section>
                <h3 className="mb-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    Fades
                </h3>
                <div className="space-y-2">
                    <div>
                        <div className="flex items-center justify-between mb-1">
                            <label className="text-[10px] text-muted-foreground">Fade In</label>
                            <span className="text-[10px] font-mono text-foreground">{clip.fadeInBeats.toFixed(2)} beats</span>
                        </div>
                        <Slider
                            value={[clip.fadeInBeats]}
                            onValueChange={([v]) => { if (v !== undefined) setClipFade(clip.id, v, clip.fadeOutBeats); }}
                            max={duration / 2}
                            step={0.25}
                            aria-label="Fade in duration"
                        />
                    </div>
                    <div>
                        <div className="flex items-center justify-between mb-1">
                            <label className="text-[10px] text-muted-foreground">Fade Out</label>
                            <span className="text-[10px] font-mono text-foreground">{clip.fadeOutBeats.toFixed(2)} beats</span>
                        </div>
                        <Slider
                            value={[clip.fadeOutBeats]}
                            onValueChange={([v]) => { if (v !== undefined) setClipFade(clip.id, clip.fadeInBeats, v); }}
                            max={duration / 2}
                            step={0.25}
                            aria-label="Fade out duration"
                        />
                    </div>
                </div>
            </section>

            <Separator />

            <section>
                <h3 className="mb-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    Gain
                </h3>
                <div>
                    <div className="flex items-center justify-between mb-1">
                        <label className="text-[10px] text-muted-foreground">Clip Gain</label>
                        <span className="text-[10px] font-mono text-muted-foreground">{(clip.gain * 100).toFixed(0)}%</span>
                    </div>
                    <Slider
                        value={[clip.gain * 100]}
                        onValueChange={([v]) => { if (v !== undefined) { setClipGain(clip.id, v / 100); } }}
                        max={200}
                        step={1}
                        aria-label="Clip gain"
                    />
                </div>
            </section>

            <Separator />

            <section>
                <h3 className="mb-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    Color
                </h3>
                <div className="flex gap-1">
                    {CLIP_COLOR_PRESETS.map((c) => (
                        <button
                            key={c || "default"}
                            className="size-4 rounded-full border border-border/50 hover:ring-1 hover:ring-foreground/30"
                            style={{
                                backgroundColor: c || "var(--color-muted)",
                                outline: c === clip.color ? "2px solid white" : "none",
                                outlineOffset: "1px",
                            }}
                            onClick={() => setClipColor(clip.id, c)}
                            aria-label={c || "Default color"}
                        />
                    ))}
                </div>
            </section>

            <Separator />

            <section>
                <h3 className="mb-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    Properties
                </h3>
                <div className="space-y-1">
                    <div className="flex items-center justify-between">
                        <label className="text-[10px] text-muted-foreground">Type</label>
                        <span className="text-[10px] font-mono text-foreground capitalize">{clip.type}</span>
                    </div>
                    <div className="flex items-center justify-between">
                        <label className="text-[10px] text-muted-foreground">Track</label>
                        <span className="text-[10px] font-mono text-foreground">{clip.trackId}</span>
                    </div>
                    {clip.type === "audio" && (
                        <div className="flex items-center justify-between">
                            <label className="text-[10px] text-muted-foreground">Audio Source</label>
                            <span className="text-[10px] font-mono text-foreground truncate max-w-24">
                                {clip.audioBufferId ? clip.audioBufferId.slice(0, 16) + "…" : "none"}
                            </span>
                        </div>
                    )}
                </div>
            </section>
        </div>
    );
};

const DeviceInspector = ({ device, trackId, onBack }: { device: Device; trackId: string; onBack: () => void }): ReactElement => {
    const { tracks: allTracks } = useTracks();
    const plugin = BUILTIN_PLUGINS.find((p) => p.name === device.type || p.name === device.name);
    const parameters = plugin?.parameters ?? [];
    const isSidechainComp = device.type?.toLowerCase().includes("sidechain") ?? device.name?.toLowerCase().includes("sidechain");
    const sidechainSource = getSidechainSource(device.id);
    const sourceTracks = allTracks.filter((t) => t.kind !== "master" && t.kind !== "folder" && t.id !== trackId);

    return (
        <div className="space-y-4 p-3">
            <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon-xs" onClick={onBack} aria-label="Back to track">
                    <ChevronRight className="size-3 rotate-180" />
                </Button>
                <h3 className="text-xs font-medium text-foreground">{device.name}</h3>
                <div className="flex-1" />
                <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={device.bypassed ? "Enable" : "Bypass"}
                    onClick={() => bypassDevice(device.id, !device.bypassed)}
                >
                    <Power className={`size-3 ${device.bypassed ? "text-muted-foreground" : "text-emerald-400"}`} />
                </Button>
            </div>

            {isSidechainComp && (
                <section>
                    <h3 className="mb-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                        Sidechain Source
                    </h3>
                    <select
                        className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs"
                        value={sidechainSource?.sourceTrackId ?? ""}
                        onChange={(e) => {
                            const srcId = e.target.value;
                            if (srcId) {
                                addSidechainRoute(srcId, trackId, device.id);
                            } else if (sidechainSource) {
                                removeSidechainRoute(sidechainSource.id);
                            }
                        }}
                    >
                        <option value="">None</option>
                        {sourceTracks.map((t) => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                    </select>
                </section>
            )}

            {parameters.length > 0 ? (
                <section>
                    <h3 className="mb-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                        Parameters
                    </h3>
                    <div className="space-y-3">
                        {parameters.map((param) => (
                            <DeviceParameterControl key={param.id} param={param} device={device} trackId={trackId} />
                        ))}
                    </div>
                </section>
            ) : (
                <p className="text-[10px] text-muted-foreground">No parameters available for this device.</p>
            )}
        </div>
    );
};

const DeviceParameterControl = ({ param, device, trackId }: { param: DeviceParameter; device: Device; trackId: string }): ReactElement => {
    const autoState = useSyncExternalStore(
        (cb) => automationStore.subscribe(cb),
        () => automationStore.value,
    );

    const hasAutomation = autoState?.lanes.some(
        (l) => l.trackId === trackId && l.parameterId === param.id,
    ) ?? false;

    const value = device.parameterValues[param.id] ?? param.value;
    const range = param.maxValue - param.minValue;
    const normalized = range !== 0 ? ((value - param.minValue) / range) * 100 : 50;

    const handleChange = ([v]: number[]) => {
        if (v === undefined) {
            return;
        }
        const newValue = param.minValue + (v / 100) * range;
        setDeviceParameter(device.id, param.id, newValue);
    };

    return (
        <div>
            <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] text-muted-foreground">{param.name}</label>
                <div className="flex items-center gap-1">
                    <span className="text-[10px] font-mono text-muted-foreground">
                        {value.toFixed(param.type === "int" ? 0 : 1)}{param.unit ? ` ${param.unit}` : ""}
                    </span>
                    <MidiLearnButton
                        targetType="deviceParam"
                        trackId={trackId}
                        deviceId={device.id}
                        paramId={param.id}
                    />
                    {param.automatable && (
                        <button
                            className={cn(
                                "size-3 rounded-full border",
                                hasAutomation
                                    ? "border-orange-400 bg-orange-400/20"
                                    : "border-muted-foreground/30",
                            )}
                            onClick={() => addAutoLane(trackId, param.id, param.name)}
                            aria-label={`Automate ${param.name}`}
                            title={hasAutomation ? "Automation active" : "Add automation lane"}
                        />
                    )}
                </div>
            </div>
            <Slider
                value={[normalized]}
                onValueChange={handleChange}
                max={100}
                step={0.1}
                aria-label={param.name}
            />
        </div>
    );
};

const SendsEditor = ({ track }: { track: Track }): ReactElement => {
    const { tracks: allTracks } = useTracks();
    const buses = allTracks.filter((t) => t.kind === "bus");

    return (
        <section>
            <h3 className="mb-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                Sends
            </h3>
            {buses.length > 0 ? (
                <div className="space-y-1.5">
                    {buses.map((bus) => {
                        const send = track.sends.find((s) => s.busId === bus.id);
                        const level = send?.level ?? 0;
                        const isPreFader = send?.preFader ?? false;
                        return (
                            <div key={bus.id} className="space-y-0.5">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-muted-foreground">{bus.name}</span>
                                    <div className="flex items-center gap-1">
                                        <button
                                            className={cn(
                                                "shrink-0 rounded px-1 py-0.5 text-[9px] font-bold leading-tight",
                                                isPreFader
                                                    ? "bg-yellow-500/20 text-yellow-400"
                                                    : "bg-muted/20 text-muted-foreground hover:bg-muted/30",
                                            )}
                                            onClick={() => toggleSendPreFader(track.id, bus.id)}
                                            aria-label={`Toggle send to ${bus.name} ${isPreFader ? "post" : "pre"}-fader`}
                                            title={isPreFader ? "Pre-fader (click for post)" : "Post-fader (click for pre)"}
                                        >
                                            {isPreFader ? "PRE" : "POST"}
                                        </button>
                                        <span className="text-[10px] font-mono text-muted-foreground">{(level * 100).toFixed(0)}%</span>
                                    </div>
                                </div>
                                <Slider
                                    value={[level * 100]}
                                    onValueChange={([v]) => {
                                        if (v !== undefined) {
                                            setSend(track.id, bus.id, v / 100);
                                        }
                                    }}
                                    max={100}
                                    step={1}
                                    aria-label={`Send to ${bus.name}`}
                                />
                            </div>
                        );
                    })}
                </div>
            ) : (
                <p className="text-[10px] text-muted-foreground">No bus tracks. Create a bus to add sends.</p>
            )}
        </section>
    );
};
