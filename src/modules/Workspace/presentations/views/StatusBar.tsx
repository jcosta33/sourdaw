import { type ReactElement, useEffect, useRef, useSyncExternalStore } from 'react';
import { getEngineState, getMasterPeakLevel } from '../../useCases/workspaceViewActions';
import { useUndoState } from '../hooks/useUndoState';
import { useCollaborationState } from '../hooks/useCollaborationState';
import { cn } from '#/helpers/Styles/cn';
import { workspaceStore } from '#/modules/Workspace/stores/workspaceStore';
import { trackStore } from '#/modules/Track/stores/trackStore';
import { llmStatusStore } from '#/modules/AiRuntime/stores/llmStatusStore';
import { animationScheduler } from '#/helpers/DOM/AnimationScheduler';
import { History, Users } from 'lucide-react';
import { Button } from '#/components/ui/button';

export const StatusBar = (): ReactElement => {
    const undoState = useUndoState();
    const collab = useCollaborationState();
    
    // GPU / LLM status
    const llmStatus = useSyncExternalStore(
        (cb) => llmStatusStore.subscribe(() => cb()),
        () => llmStatusStore.value
    );

    const id = crypto.randomUUID();
    const lastFrameRef = useRef(0);
    const cpuSamplesRef = useRef<number[]>([]);

    const cpuBarRef = useRef<HTMLDivElement>(null);
    const cpuTextRef = useRef<HTMLSpanElement>(null);
    const memContainerRef = useRef<HTMLDivElement>(null);
    const memTextRef = useRef<HTMLSpanElement>(null);
    const sampleRateRef = useRef<HTMLSpanElement>(null);
    const latencyRef = useRef<HTMLSpanElement>(null);
    const masterLevelBarRef = useRef<HTMLDivElement>(null);
    const masterLevelTextRef = useRef<HTMLSpanElement>(null);
    const engineStateRef = useRef<HTMLSpanElement>(null);

    useEffect(() => {
        lastFrameRef.current = performance.now();
        const tick = () => {
            const now = performance.now();
            const frameDelta = now - lastFrameRef.current;
            lastFrameRef.current = now;

            const engineInfo = getEngineState();
            const masterLevel = getMasterPeakLevel();

            const targetFrameMs = 1000 / 60;
            const load = Math.min(100, (frameDelta / targetFrameMs) * 100 - 100);
            const samples = cpuSamplesRef.current;
            samples.push(Math.max(0, load));
            if (samples.length > 30) {
                samples.shift();
            }
            let sum = 0;
            for (let i = 0; i < samples.length; i++) {
                sum += samples[i]!;
            }
            const avg = sum / samples.length;
            const cpuPct = Math.round(avg);

            if (cpuBarRef.current) {
                cpuBarRef.current.style.width = `${Math.min(100, cpuPct)}%`;
                cpuBarRef.current.className = `h-full rounded-full transition-[width] duration-150 ${
                    cpuPct < 50 ? 'bg-[var(--color-state-success)]' : cpuPct < 80 ? 'bg-[var(--color-state-warning)]' : 'bg-[var(--color-state-danger)]'
                }`;
            }
            if (cpuTextRef.current) {
                cpuTextRef.current.textContent = `${cpuPct}%`;
            }

            const perfMemory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
            if (perfMemory) {
                const memMb = Math.round(perfMemory.usedJSHeapSize / (1024 * 1024));
                if (memContainerRef.current) {
                    memContainerRef.current.style.display = memMb > 0 ? 'flex' : 'none';
                }
                if (memTextRef.current) {
                    memTextRef.current.textContent = `${memMb} MB`;
                }
            } else {
                if (memContainerRef.current) {
                    memContainerRef.current.style.display = 'none';
                }
            }

            if (sampleRateRef.current) {
                sampleRateRef.current.textContent = `${engineInfo.sampleRate / 1000}kHz`;
            }
            if (latencyRef.current) {
                latencyRef.current.textContent = `${(engineInfo.baseLatency * 1000).toFixed(1)}ms`;
            }
            if (engineStateRef.current) {
                engineStateRef.current.className = `size-1.5 rounded-full ${
                    engineInfo.state === 'running' ? 'bg-[var(--color-state-success)]' : 'bg-muted-foreground/50'
                }`;
                engineStateRef.current.title = `Engine: ${engineInfo.state}`;
            }

            const levelDb = masterLevel > 0 ? (20 * Math.log10(masterLevel)).toFixed(1) : '-∞';
            if (masterLevelBarRef.current) {
                masterLevelBarRef.current.style.width = `${Math.min(100, masterLevel * 300)}%`;
            }
            if (masterLevelTextRef.current) {
                masterLevelTextRef.current.textContent = `${levelDb} dB`;
            }
        };
        animationScheduler.register(`status-${id}`, tick);
        return () => animationScheduler.unregister(`status-${id}`);
    }, []);

    const selectionLabel = useSyncExternalStore(
        (cb) => {
            const unsub1 = workspaceStore.subscribe(cb);
            const unsub2 = trackStore.subscribe(cb);
            return () => {
                unsub1();
                unsub2();
            };
        },
        () => {
            const ids = workspaceStore.value?.selectedClipIds ?? [];
            if (ids.length === 0) {
                return '';
            }
            const allClips = trackStore.value?.tracks.flatMap((t) => t.clips) ?? [];
            if (ids.length === 1) {
                const clip = allClips.find((c) => c.id === ids[0]);
                if (!clip) {
                    return '1 clip';
                }
                const beats = clip.endBeat - clip.startBeat;
                const bars = beats / 4;
                return bars === Math.floor(bars)
                    ? `1 clip · ${bars} bar${bars !== 1 ? 's' : ''}`
                    : `1 clip · ${beats} beat${beats !== 1 ? 's' : ''}`;
            }
            return `${ids.length} clips selected`;
        }
    );

    return (
        <footer
            className="flex h-6 shrink-0 items-center justify-between border-t border-black/50 bg-surface-tray shadow-[inset_0_1px_2px_rgba(0,0,0,0.4)] px-3"
            role="status"
            aria-label="Application status"
        >
            <div className="flex items-center gap-3">
                <div className="flex items-center gap-1">
                    <span className="text-[10px] text-muted-foreground">CPU:</span>
                    <div className="h-2 w-10 rounded-full bg-muted/30 overflow-hidden">
                        <div
                            ref={cpuBarRef}
                            className="h-full rounded-full transition-[width] duration-150 bg-[var(--color-state-success)]"
                            style={{ width: '0%' }}
                        />
                    </div>
                    <span ref={cpuTextRef} className="text-[10px] font-mono text-muted-foreground w-7 text-right">0%</span>
                </div>
                
                <div ref={memContainerRef} className="flex items-center gap-1" style={{ display: 'none' }}>
                    <span className="text-[10px] text-muted-foreground">MEM:</span>
                    <span ref={memTextRef} className="text-[10px] font-mono text-muted-foreground">0 MB</span>
                </div>
                
                <div className="flex items-center gap-1">
                    <span className="text-[10px] text-muted-foreground">GPU:</span>
                    {llmStatus?.state === 'generating' ? (
                        <span className="text-[10px] font-mono text-[var(--color-accent-lavender)] animate-pulse">active</span>
                    ) : llmStatus?.state === 'loading' ? (
                        <span className="text-[10px] font-mono text-[var(--color-state-warning)]">
                            {Math.round(llmStatus.progress * 100)}%
                        </span>
                    ) : llmStatus?.state === 'ready' ? (
                        <span className="text-[10px] font-mono text-[var(--color-state-success)]/70">ready</span>
                    ) : (
                        <span className="text-[10px] font-mono text-muted-foreground/50">idle</span>
                    )}
                </div>
                
                <span ref={sampleRateRef} className="text-[10px] font-mono tabular-nums text-muted-foreground">0kHz</span>
                <span ref={latencyRef} className="text-[10px] font-mono tabular-nums text-muted-foreground">0.0ms</span>
                
                <div className="flex items-center gap-1">
                    <div className="h-2 w-16 rounded-full bg-muted/30 overflow-hidden">
                        <div
                            ref={masterLevelBarRef}
                            className="h-full rounded-full bg-[var(--color-state-success)] transition-[width] duration-75"
                            style={{ width: '0%' }}
                        />
                    </div>
                    <span ref={masterLevelTextRef} className="text-[10px] font-mono text-muted-foreground w-10 text-right">-∞ dB</span>
                </div>
            </div>

            {selectionLabel && <span className="text-[10px] text-muted-foreground">{selectionLabel}</span>}

            <div className="flex items-center gap-3">
                {undoState.lastAction && (
                    <span className="text-[10px] text-muted-foreground/60">Last: {undoState.lastAction.label}</span>
                )}
                <Button
                    variant="ghost"
                    size="xs"
                    className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground h-5"
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
                            'size-1.5 rounded-full',
                            collab.connectionStatus === 'connected' ? 'bg-[var(--color-state-success)]' : 'bg-muted-foreground/50'
                        )}
                    />
                    <Users className="size-3" />
                    {collab.isEnabled ? collab.peers.length : 0}
                </Button>
                <Button
                    variant="ghost"
                    size="xs"
                    className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground h-5"
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
                    {undoState.undoCount} undo{undoState.undoCount !== 1 ? 's' : ''}
                </Button>
                <span
                    ref={engineStateRef}
                    className="size-1.5 rounded-full bg-muted-foreground/50"
                    title="Engine: suspended"
                />
            </div>
        </footer>
    );
};
