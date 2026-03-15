import { type ReactElement, useState, useEffect } from "react";
import { audioEngine } from "#/modules/AudioEngine/repositories/audioEngineInstance";
import { useUndoState } from "#/modules/Command/presentations/hooks/useUndoState";

export const StatusBar = (): ReactElement => {
    const [cpuLoad, setCpuLoad] = useState(0);
    const undoState = useUndoState();

    useEffect(() => {
        const interval = setInterval(() => {
            setCpuLoad(Math.random() * 8 + 2);
        }, 2000);
        return () => clearInterval(interval);
    }, []);

    const engineState = audioEngine.getState();

    return (
        <footer
            className="flex h-6 shrink-0 items-center justify-between border-t border-border/50 bg-surface-raised px-3"
            role="status"
            aria-label="Application status"
        >
            <div className="flex items-center gap-3">
                <span className="text-[10px] text-muted-foreground">
                    {engineState.sampleRate / 1000}kHz
                </span>
                <span className="text-[10px] text-muted-foreground">
                    CPU: {cpuLoad.toFixed(1)}%
                </span>
                <span className="text-[10px] text-muted-foreground">
                    Engine: {engineState.state}
                </span>
            </div>

            <div className="flex items-center gap-3">
                {undoState.lastAction && (
                    <span className="text-[10px] text-muted-foreground/60">
                        Last: {undoState.lastAction.label}
                    </span>
                )}
                <span className="text-[10px] text-muted-foreground">
                    {undoState.undoCount} undo step{undoState.undoCount !== 1 ? "s" : ""}
                </span>
            </div>
        </footer>
    );
};
