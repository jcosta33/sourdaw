import { type ReactElement, useState, useEffect, useRef, useSyncExternalStore } from "react";
import { audioEngine } from "#/modules/AudioEngine/repositories/audioEngineInstance";
import { useUndoState } from "#/modules/Command/presentations/hooks/useUndoState";
import { useCollaborationState } from "#/modules/Collaboration/presentations/hooks/useCollaborationState";
import { cn } from "#/helpers/Styles/cn";
import { workspaceStore } from "#/modules/Workspace/stores/workspaceStore";
import { trackStore } from "#/modules/Track/stores/trackStore";
import { History, Users } from "lucide-react";

export const StatusBar = (): ReactElement => {
    const [engineInfo, setEngineInfo] = useState(() => audioEngine.getState());
    const [masterLevel, setMasterLevel] = useState(0);
    const [cpuLoad, setCpuLoad] = useState(0);
    const undoState = useUndoState();
    const collab = useCollaborationState();
    const rafRef = useRef(0);
    const lastFrameRef = useRef(performance.now());
    const cpuSamplesRef = useRef<number[]>([]);

    useEffect(() => {
        const tick = () => {
            const now = performance.now();
            const frameDelta = now - lastFrameRef.current;
            lastFrameRef.current = now;

            setEngineInfo(audioEngine.getState());
            setMasterLevel(audioEngine.getMasterPeakLevel());

            const targetFrameMs = 1000 / 60;
            const load = Math.min(100, (frameDelta / targetFrameMs) * 100 - 100);
            const samples = cpuSamplesRef.current;
            samples.push(Math.max(0, load));
            if (samples.length > 30) samples.shift();
            const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
            setCpuLoad(avg);

            rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(rafRef.current);
    }, []);

    const selectionLabel = useSyncExternalStore(
        (cb) => {
            const unsub1 = workspaceStore.subscribe(cb);
            const unsub2 = trackStore.subscribe(cb);
            return () => { unsub1(); unsub2(); };
        },
        () => {
            const ids = workspaceStore.value?.selectedClipIds ?? [];
            if (ids.length === 0) return "";
            const allClips = trackStore.value?.tracks.flatMap((t) => t.clips) ?? [];
            if (ids.length === 1) {
                const clip = allClips.find((c) => c.id === ids[0]);
                if (!clip) return "1 clip";
                const beats = clip.endBeat - clip.startBeat;
                const bars = beats / 4;
                return bars === Math.floor(bars)
                    ? `1 clip · ${bars} bar${bars !== 1 ? "s" : ""}`
                    : `1 clip · ${beats} beat${beats !== 1 ? "s" : ""}`;
            }
            return `${ids.length} clips selected`;
        },
    );

    const latencyMs = (engineInfo.baseLatency * 1000).toFixed(1);
    const levelDb = masterLevel > 0 ? (20 * Math.log10(masterLevel)).toFixed(1) : "-∞";
    const cpuPct = Math.round(cpuLoad);

    return (
        <footer
            className="flex h-6 shrink-0 items-center justify-between border-t border-border/50 bg-surface-raised px-3"
            role="status"
            aria-label="Application status"
        >
            <div className="flex items-center gap-3">
                <div className="flex items-center gap-1">
                    <span className="text-[10px] text-muted-foreground">CPU:</span>
                    <div className="h-2 w-10 rounded-full bg-muted/30 overflow-hidden">
                        <div
                            className={cn(
                                "h-full rounded-full transition-[width] duration-150",
                                cpuPct < 50 ? "bg-emerald-500" : cpuPct < 80 ? "bg-yellow-500" : "bg-red-500",
                            )}
                            style={{ width: `${Math.min(100, cpuPct)}%` }}
                        />
                    </div>
                    <span className="text-[10px] font-mono text-muted-foreground w-7 text-right">{cpuPct}%</span>
                </div>
                <span className="text-[10px] text-muted-foreground">
                    {engineInfo.sampleRate / 1000}kHz
                </span>
                <span className="text-[10px] text-muted-foreground">
                    {latencyMs}ms
                </span>
                <div className="flex items-center gap-1">
                    <div className="h-2 w-16 rounded-full bg-muted/30 overflow-hidden">
                        <div
                            className="h-full rounded-full bg-emerald-500 transition-[width] duration-75"
                            style={{ width: `${Math.min(100, masterLevel * 300)}%` }}
                        />
                    </div>
                    <span className="text-[10px] font-mono text-muted-foreground w-10 text-right">{levelDb} dB</span>
                </div>
            </div>

            {selectionLabel && (
                <span className="text-[10px] text-muted-foreground">
                    {selectionLabel}
                </span>
            )}

            <div className="flex items-center gap-3">
                {undoState.lastAction && (
                    <span className="text-[10px] text-muted-foreground/60">
                        Last: {undoState.lastAction.label}
                    </span>
                )}
                <button
                    className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => {
                        const ws = workspaceStore.value;
                        if (ws) {
                            workspaceStore.set({ ...ws, collaborationPanelOpen: !ws.collaborationPanelOpen });
                        }
                    }}
                    aria-label="Toggle collaboration panel"
                    title="Collaboration"
                >
                    <span
                        className={cn(
                            "size-1.5 rounded-full",
                            collab.connectionStatus === "connected"
                                ? "bg-emerald-500"
                                : "bg-muted-foreground/50",
                        )}
                    />
                    <Users className="size-3" />
                    {collab.isEnabled ? collab.peers.length : 0}
                </button>
                <button
                    className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => {
                        const ws = workspaceStore.value;
                        if (ws) {
                            workspaceStore.set({ ...ws, undoHistoryOpen: !ws.undoHistoryOpen });
                        }
                    }}
                    aria-label="Toggle undo history panel"
                    title="Undo history"
                >
                    <History className="size-3" />
                    {undoState.undoCount} undo{undoState.undoCount !== 1 ? "s" : ""}
                </button>
                <span
                    className={cn(
                        "size-1.5 rounded-full",
                        engineInfo.state === "running" ? "bg-emerald-500" : "bg-muted-foreground/50",
                    )}
                    title={`Engine: ${engineInfo.state}`}
                />
            </div>
        </footer>
    );
};
