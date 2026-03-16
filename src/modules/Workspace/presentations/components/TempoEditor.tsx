import { type ReactElement, useState, useRef, useEffect, useSyncExternalStore } from "react";
import { Input } from "#/components/ui/input";
import { Button } from "#/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "#/components/ui/tooltip";
import { cn } from "#/helpers/Styles/cn";
import { useTransportState } from "#/modules/Transport/presentations/hooks/useTransportState";
import { setTempo } from "#/modules/Transport/useCases/setTempo";
import { transportStore } from "#/modules/Transport/stores/transportStore";
import { tempoMapStore, type TempoMapStoreState } from "#/modules/Transport/stores/tempoMapStore";
import { addTempoChange, removeTempoChange, updateTempoChange } from "#/modules/Transport/useCases/tempoMapUseCases";
import type { TempoChange } from "#/modules/Transport/models/TempoMap";
import { Map, Plus, Trash2 } from "lucide-react";

const defaultTempoMapState: TempoMapStoreState = { changes: [] };

const useTempoMapState = (): TempoMapStoreState => {
    return useSyncExternalStore(
        (onChange) => tempoMapStore.subscribe(() => onChange()),
        () => tempoMapStore.value ?? defaultTempoMapState,
        () => tempoMapStore.value ?? defaultTempoMapState,
    );
};

export const TempoEditor = (): ReactElement => {
    const transport = useTransportState();
    const tempoMap = useTempoMapState();
    const [editingTempo, setEditingTempo] = useState(false);
    const [editingTimeSig, setEditingTimeSig] = useState(false);
    const [tempoValue, setTempoValue] = useState("");
    const [numValue, setNumValue] = useState("");
    const [denValue, setDenValue] = useState("");
    const tapTimesRef = useRef<number[]>([]);
    const [mapOpen, setMapOpen] = useState(false);
    const mapPanelRef = useRef<HTMLDivElement>(null);
    const [newBeat, setNewBeat] = useState("0");
    const [newTempo, setNewTempo] = useState("120");
    const [newCurve, setNewCurve] = useState<TempoChange["curve"]>("instant");
    const [editingChangeId, setEditingChangeId] = useState<string | null>(null);
    const [editingChangeTempo, setEditingChangeTempo] = useState("");

    useEffect(() => {
        if (!mapOpen) return;

        const handleClickOutside = (e: MouseEvent) => {
            if (mapPanelRef.current && !mapPanelRef.current.contains(e.target as Node)) {
                setMapOpen(false);
            }
        };

        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [mapOpen]);

    const startTempoEdit = () => {
        setTempoValue(transport.tempo.toFixed(2));
        setEditingTempo(true);
    };

    const commitTempo = () => {
        const bpm = parseFloat(tempoValue);
        if (!isNaN(bpm) && bpm >= 20 && bpm <= 300) {
            setTempo(bpm);
        }
        setEditingTempo(false);
    };

    const startTimeSigEdit = () => {
        setNumValue(String(transport.timeSignatureNumerator));
        setDenValue(String(transport.timeSignatureDenominator));
        setEditingTimeSig(true);
    };

    const commitTimeSig = () => {
        const num = parseInt(numValue, 10);
        const den = parseInt(denValue, 10);
        if (num >= 1 && num <= 32 && [2, 4, 8, 16].includes(den)) {
            const state = transportStore.value;
            if (state) {
                transportStore.set({ ...state, timeSignatureNumerator: num, timeSignatureDenominator: den });
            }
        }
        setEditingTimeSig(false);
    };

    const handleAddTempoChange = () => {
        const beat = parseFloat(newBeat);
        const tempo = parseFloat(newTempo);
        if (isNaN(beat) || beat < 0 || isNaN(tempo) || tempo < 20 || tempo > 999) return;
        addTempoChange(beat, tempo, newCurve);
        setNewBeat(String(beat + 4));
    };

    const startEditChange = (change: TempoChange) => {
        setEditingChangeId(change.id);
        setEditingChangeTempo(String(change.tempo));
    };

    const commitEditChange = () => {
        if (!editingChangeId) return;
        const bpm = parseFloat(editingChangeTempo);
        if (!isNaN(bpm) && bpm >= 20 && bpm <= 999) {
            updateTempoChange(editingChangeId, bpm);
        }
        setEditingChangeId(null);
    };

    const handleTapTempo = () => {
        const now = performance.now();
        const taps = tapTimesRef.current;
        taps.push(now);

        if (taps.length > 8) taps.shift();
        if (taps.length < 2) return;

        const recentTaps = taps.filter((t) => now - t < 4000);
        tapTimesRef.current = recentTaps;

        if (recentTaps.length < 2) return;

        let totalInterval = 0;
        for (let i = 1; i < recentTaps.length; i++) {
            totalInterval += recentTaps[i]! - recentTaps[i - 1]!;
        }
        const avgInterval = totalInterval / (recentTaps.length - 1);
        if (avgInterval <= 0) {
            return;
        }
        const bpm = Math.round((60000 / avgInterval) * 100) / 100;

        if (bpm >= 20 && bpm <= 300) {
            setTempo(bpm);
        }
    };

    return (
        <div className="relative flex items-center gap-1 px-1">
            {editingTempo ? (
                <Input
                    type="number"
                    value={tempoValue}
                    onChange={(e) => setTempoValue(e.target.value)}
                    onBlur={commitTempo}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") commitTempo();
                        if (e.key === "Escape") setEditingTempo(false);
                    }}
                    className="h-6 w-16 text-center font-mono text-xs"
                    min={20}
                    max={300}
                    step={0.01}
                    autoFocus
                    aria-label="Tempo BPM"
                />
            ) : (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <button
                            className="rounded px-1 hover:bg-accent/50 transition-colors"
                            onClick={startTempoEdit}
                            aria-label={`Tempo: ${transport.tempo} BPM. Click to edit.`}
                        >
                            <span className="font-mono text-xs tabular-nums text-foreground">
                                {transport.tempo.toFixed(2)}
                            </span>
                            <span className="text-xs text-muted-foreground ml-0.5">BPM</span>
                        </button>
                    </TooltipTrigger>
                    <TooltipContent>Click to edit tempo</TooltipContent>
                </Tooltip>
            )}

            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => setMapOpen(!mapOpen)}
                        aria-label="Toggle tempo map"
                        aria-expanded={mapOpen}
                        className={cn("size-5", mapOpen && "bg-accent")}
                    >
                        <Map className="size-3" />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>Tempo map</TooltipContent>
            </Tooltip>

            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={handleTapTempo}
                        aria-label="Tap tempo"
                        className="text-[9px] font-bold w-6 h-5"
                    >
                        TAP
                    </Button>
                </TooltipTrigger>
                <TooltipContent>Tap to set tempo</TooltipContent>
            </Tooltip>

            {editingTimeSig ? (
                <div className="flex items-center gap-0.5">
                    <Input
                        type="number"
                        value={numValue}
                        onChange={(e) => setNumValue(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") commitTimeSig();
                            if (e.key === "Escape") setEditingTimeSig(false);
                        }}
                        className="h-6 w-8 text-center font-mono text-xs"
                        min={1}
                        max={32}
                        autoFocus
                        aria-label="Time signature numerator"
                    />
                    <span className="text-xs text-muted-foreground">/</span>
                    <select
                        value={denValue}
                        onChange={(e) => setDenValue(e.target.value)}
                        onBlur={commitTimeSig}
                        className="h-6 w-10 rounded bg-surface-overlay text-center font-mono text-xs text-foreground outline-none"
                        aria-label="Time signature denominator"
                    >
                        <option value="2">2</option>
                        <option value="4">4</option>
                        <option value="8">8</option>
                        <option value="16">16</option>
                    </select>
                </div>
            ) : (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <button
                            className="rounded px-1 hover:bg-accent/50 transition-colors"
                            onClick={startTimeSigEdit}
                            aria-label={`Time signature: ${transport.timeSignatureNumerator}/${transport.timeSignatureDenominator}. Click to edit.`}
                        >
                            <span className="text-xs text-muted-foreground">
                                {transport.timeSignatureNumerator}/{transport.timeSignatureDenominator}
                            </span>
                        </button>
                    </TooltipTrigger>
                    <TooltipContent>Click to edit time signature</TooltipContent>
                </Tooltip>
            )}

            {mapOpen && (
                <div
                    ref={mapPanelRef}
                    role="dialog"
                    aria-label="Tempo map editor"
                    className="absolute left-0 top-full z-50 mt-1 w-72 rounded-md border border-border bg-surface-overlay p-2 shadow-lg"
                >
                    <h3 className="mb-1.5 text-xs font-semibold text-foreground">Tempo Map</h3>

                    {tempoMap.changes.length === 0 ? (
                        <p className="py-2 text-center text-xs text-muted-foreground">No tempo changes</p>
                    ) : (
                        <div className="max-h-40 space-y-0.5 overflow-y-auto">
                            {tempoMap.changes.map((change) => (
                                <div
                                    key={change.id}
                                    className="flex items-center gap-1.5 rounded px-1.5 py-1 text-xs hover:bg-accent/30"
                                >
                                    <span className="w-12 shrink-0 font-mono tabular-nums text-muted-foreground">
                                        Beat {change.beat}
                                    </span>

                                    {editingChangeId === change.id ? (
                                        <Input
                                            type="number"
                                            value={editingChangeTempo}
                                            onChange={(e) => setEditingChangeTempo(e.target.value)}
                                            onBlur={commitEditChange}
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter") commitEditChange();
                                                if (e.key === "Escape") setEditingChangeId(null);
                                            }}
                                            className="h-5 w-14 text-center font-mono text-xs"
                                            min={20}
                                            max={999}
                                            step={0.1}
                                            autoFocus
                                            aria-label={`Edit tempo at beat ${change.beat}`}
                                        />
                                    ) : (
                                        <button
                                            className="w-14 rounded text-center font-mono tabular-nums text-foreground hover:bg-accent/50"
                                            onClick={() => startEditChange(change)}
                                            aria-label={`${change.tempo} BPM at beat ${change.beat}. Click to edit.`}
                                        >
                                            {change.tempo}
                                        </button>
                                    )}

                                    <span className="text-muted-foreground">BPM</span>

                                    <span
                                        className={cn(
                                            "rounded px-1 py-0.5 text-[10px]",
                                            change.curve === "linear"
                                                ? "bg-blue-500/20 text-blue-400"
                                                : "bg-muted text-muted-foreground",
                                        )}
                                    >
                                        {change.curve}
                                    </span>

                                    <Button
                                        variant="ghost"
                                        size="icon-xs"
                                        className="ml-auto size-5 text-muted-foreground hover:text-destructive"
                                        onClick={() => removeTempoChange(change.id)}
                                        aria-label={`Remove tempo change at beat ${change.beat}`}
                                    >
                                        <Trash2 className="size-3" />
                                    </Button>
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="mt-2 flex items-center gap-1 border-t border-border pt-2">
                        <Input
                            type="number"
                            value={newBeat}
                            onChange={(e) => setNewBeat(e.target.value)}
                            className="h-6 w-14 text-center font-mono text-xs"
                            min={0}
                            step={1}
                            placeholder="Beat"
                            aria-label="New tempo change beat"
                        />
                        <Input
                            type="number"
                            value={newTempo}
                            onChange={(e) => setNewTempo(e.target.value)}
                            className="h-6 w-14 text-center font-mono text-xs"
                            min={20}
                            max={999}
                            step={0.1}
                            placeholder="BPM"
                            aria-label="New tempo change BPM"
                        />
                        <select
                            value={newCurve}
                            onChange={(e) => setNewCurve(e.target.value as TempoChange["curve"])}
                            className="h-6 rounded bg-muted px-1 text-xs text-foreground outline-none"
                            aria-label="New tempo change curve type"
                        >
                            <option value="instant">instant</option>
                            <option value="linear">linear</option>
                        </select>
                        <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={handleAddTempoChange}
                            aria-label="Add tempo change"
                            className="size-6"
                        >
                            <Plus className="size-3" />
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
};
