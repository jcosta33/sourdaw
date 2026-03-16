import { type ReactElement, useState, useMemo, useSyncExternalStore } from "react";
import {
    Play,
    Pause,
    Square,
    Circle,
    Repeat,
    Mic,
    PanelLeft,
    PanelRight,
    LayoutPanelTop,
    ChevronsRight,
    Scissors,
    ListOrdered,
} from "lucide-react";
import { Button } from "#/components/ui/button";
import { Separator } from "#/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "#/components/ui/tooltip";
import { cn } from "#/helpers/Styles/cn";
import { useWorkspaceState } from "../hooks/useWorkspaceState";
import { useTransportState } from "#/modules/Transport/presentations/hooks/useTransportState";
import { useUndoState } from "#/modules/Command/presentations/hooks/useUndoState";
import { useAiRuntimeState } from "#/modules/AiRuntime/presentations/hooks/useAiRuntimeState";
import { useProjectState } from "#/modules/Project/presentations/hooks/useProjectState";
import { renameProject, saveProject } from "#/modules/Project/useCases/projectPersistence";
import { setWorkspaceMode } from "../../useCases/setWorkspaceMode";
import { toggleSidebar, toggleInspector, toggleMixer, setSoloMode } from "../../useCases/togglePanel";
import { togglePlayback, stopPlayback, toggleLoop, toggleMetronome, setMetronomeVolume, toggleRecording, togglePunchEnabled, toggleCountIn, togglePreRoll } from "#/modules/Transport/useCases/transportControls";
import { undo, redo } from "#/modules/Command/useCases/undoRedo";
import { PromptBar } from "./PromptBar";
import { ToolSelector } from "./ToolSelector";
import { TempoEditor } from "./TempoEditor";
import { RecentProjectsMenu } from "#/modules/Project/presentations/components/RecentProjectsMenu";
import type { WorkspaceMode, SoloMode, TimeDisplayMode } from "../../models/WorkspaceState";
import { Undo2, Redo2 } from "lucide-react";
import { timelineViewStore, toggleAutoScroll } from "#/modules/Timeline/stores/timelineViewStore";
import { trackStore } from "#/modules/Track/stores/trackStore";
import { workspaceStore } from "../../stores/workspaceStore";

export const TransportBar = (): ReactElement => {
    const { mode, sidebarOpen, inspectorOpen, mixerOpen, soloMode, timeDisplayMode } = useWorkspaceState();
    const transport = useTransportState();
    const undoState = useUndoState();
    const project = useProjectState();

    const tracks = useSyncExternalStore(
        (cb) => trackStore.subscribe(() => cb()),
        () => trackStore.value?.tracks ?? [],
        () => trackStore.value?.tracks ?? [],
    );
    const anyTrackArmed = useMemo(() => tracks.some((t) => t.armed), [tracks]);

    return (
        <header
            className="flex h-(--spacing-transport-height) shrink-0 items-center gap-1 border-b border-border bg-surface-raised px-2"
            role="toolbar"
            aria-label="Transport controls"
        >
            <div className="flex items-center">
                <ProjectName name={project.name} dirty={project.dirty} />
                <RecentProjectsMenu />
            </div>

            <Separator orientation="vertical" className="mx-0.5 h-5" />

            <TransportControls isPlaying={transport.isPlaying} isRecording={transport.isRecording} isLooping={transport.isLooping} metronomeEnabled={transport.metronomeEnabled} metronomeVolume={transport.metronomeVolume} punchInEnabled={transport.punchInEnabled} countInEnabled={transport.countInEnabled} preRollEnabled={transport.preRollEnabled} anyTrackArmed={anyTrackArmed} />

            <AutoScrollToggle />

            <Separator orientation="vertical" className="mx-0.5 h-5" />

            <SoloModeSelector soloMode={soloMode} />

            <Separator orientation="vertical" className="mx-0.5 h-5" />

            <PlayheadDisplay position={transport.playheadPosition} tempo={transport.tempo} numerator={transport.timeSignatureNumerator} timeDisplayMode={timeDisplayMode} />

            <Separator orientation="vertical" className="mx-0.5 h-5" />

            <TempoEditor />

            <Separator orientation="vertical" className="mx-0.5 h-5" />

            <ToolSelector />

            <Separator orientation="vertical" className="mx-0.5 h-5" />

            <WorkspaceModeSelector mode={mode} />

            <Separator orientation="vertical" className="mx-0.5 h-5" />

            <UndoRedoButtons canUndo={undoState.canUndo} canRedo={undoState.canRedo} />

            <Separator orientation="vertical" className="mx-0.5 h-5" />

            <div className="flex-1 min-w-0">
                <PromptBar />
            </div>

            <Separator orientation="vertical" className="mx-0.5 h-5" />

            <VoiceButton />

            <PanelToggles
                sidebarOpen={sidebarOpen}
                inspectorOpen={inspectorOpen}
                mixerOpen={mixerOpen}
            />

            <AiStatusIndicator />
        </header>
    );
};

const TransportControls = ({
    isPlaying,
    isRecording,
    isLooping,
    metronomeEnabled,
    metronomeVolume,
    punchInEnabled,
    countInEnabled,
    preRollEnabled,
    anyTrackArmed,
}: {
    isPlaying: boolean;
    isRecording: boolean;
    isLooping: boolean;
    metronomeEnabled: boolean;
    metronomeVolume: number;
    punchInEnabled: boolean;
    countInEnabled: boolean;
    preRollEnabled: boolean;
    anyTrackArmed: boolean;
}): ReactElement => {
    return (
        <div className="flex items-center gap-0.5" role="group" aria-label="Playback controls">
            <span className="sr-only" aria-live="polite" role="status">
                {isRecording ? "Recording" : isPlaying ? "Playing" : "Stopped"}
            </span>
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant={isPlaying ? "secondary" : "ghost"}
                        size="icon-sm"
                        aria-label={isPlaying ? "Pause" : "Play"}
                        onClick={togglePlayback}
                    >
                        {isPlaying ? <Pause className="size-4" aria-hidden="true" /> : <Play className="size-4" aria-hidden="true" />}
                    </Button>
                </TooltipTrigger>
                <TooltipContent>{isPlaying ? "Pause" : "Play"} (Space)</TooltipContent>
            </Tooltip>

            <Tooltip>
                <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label="Stop" onClick={stopPlayback}>
                        <Square className="size-3.5" aria-hidden="true" />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>Stop (Esc)</TooltipContent>
            </Tooltip>

            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant={isRecording ? "secondary" : "ghost"}
                        size="icon-sm"
                        aria-label={isRecording ? "Stop recording" : "Record"}
                        aria-pressed={isRecording}
                        onClick={toggleRecording}
                        className={cn(
                            !isRecording && anyTrackArmed && "ring-2 ring-red-500/70",
                        )}
                    >
                        <Circle className={cn("size-3.5 text-red-500", isRecording && "fill-red-500 animate-pulse")} aria-hidden="true" />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>
                    {isRecording ? "Stop Recording" : anyTrackArmed ? "Record (tracks armed)" : "Record"} (R)
                </TooltipContent>
            </Tooltip>

            <Tooltip>
                <TooltipTrigger asChild>
                    <Button variant={isLooping ? "secondary" : "ghost"} size="icon-sm" aria-label="Loop" aria-pressed={isLooping} onClick={toggleLoop}>
                        <Repeat className="size-3.5" aria-hidden="true" />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>Loop (L)</TooltipContent>
            </Tooltip>

            <Tooltip>
                <TooltipTrigger asChild>
                    <Button variant={metronomeEnabled ? "secondary" : "ghost"} size="icon-sm" aria-label="Metronome" aria-pressed={metronomeEnabled} onClick={toggleMetronome}>
                        <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M12 2L6 22h12L12 2z" />
                            <path d="M12 12l4-8" />
                        </svg>
                    </Button>
                </TooltipTrigger>
                <TooltipContent>Metronome (M)</TooltipContent>
            </Tooltip>

            {metronomeEnabled && (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.01}
                            value={metronomeVolume}
                            onChange={(e) => setMetronomeVolume(parseFloat(e.target.value))}
                            className="h-4 w-14 cursor-pointer accent-foreground opacity-70 hover:opacity-100 transition-opacity"
                            aria-label={`Metronome volume: ${Math.round(metronomeVolume * 100)}%`}
                        />
                    </TooltipTrigger>
                    <TooltipContent>Metronome volume: {Math.round(metronomeVolume * 100)}%</TooltipContent>
                </Tooltip>
            )}

            <Tooltip>
                <TooltipTrigger asChild>
                    <Button variant={punchInEnabled ? "secondary" : "ghost"} size="icon-sm" aria-label="Punch in/out" aria-pressed={punchInEnabled} onClick={togglePunchEnabled}>
                        <Scissors className="size-3.5" aria-hidden="true" />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>Punch In/Out (I)</TooltipContent>
            </Tooltip>

            <Tooltip>
                <TooltipTrigger asChild>
                    <Button variant={countInEnabled ? "secondary" : "ghost"} size="icon-sm" aria-label="Count-in" aria-pressed={countInEnabled} onClick={toggleCountIn}>
                        <ListOrdered className="size-3.5" aria-hidden="true" />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>Count-in</TooltipContent>
            </Tooltip>

            <Tooltip>
                <TooltipTrigger asChild>
                    <Button variant={preRollEnabled ? "secondary" : "ghost"} size="xs" aria-label="Pre-roll" aria-pressed={preRollEnabled} onClick={togglePreRoll}>
                        <span className="text-[10px] font-semibold">PRE</span>
                    </Button>
                </TooltipTrigger>
                <TooltipContent>Pre-roll (start playback N bars before cursor)</TooltipContent>
            </Tooltip>
        </div>
    );
};

const AutoScrollToggle = (): ReactElement => {
    const autoScrollEnabled = useSyncExternalStore(
        (onChange) => timelineViewStore.subscribe(() => onChange()),
        () => timelineViewStore.value?.autoScrollEnabled ?? true,
        () => timelineViewStore.value?.autoScrollEnabled ?? true,
    );

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Button
                    variant={autoScrollEnabled ? "secondary" : "ghost"}
                    size="icon-sm"
                    aria-label="Auto-scroll follows playhead"
                    aria-pressed={autoScrollEnabled}
                    onClick={toggleAutoScroll}
                >
                    <ChevronsRight className="size-3.5" aria-hidden="true" />
                </Button>
            </TooltipTrigger>
            <TooltipContent>Auto-scroll {autoScrollEnabled ? "on" : "off"}</TooltipContent>
        </Tooltip>
    );
};

const SOLO_MODES: { value: SoloMode; label: string; description: string }[] = [
    { value: "sip", label: "SIP", description: "Solo In Place — mutes non-soloed tracks" },
    { value: "afl", label: "AFL", description: "After Fader Listen — solo with fader applied" },
    { value: "pfl", label: "PFL", description: "Pre Fader Listen — solo at unity gain" },
];

const SoloModeSelector = ({ soloMode }: { soloMode: SoloMode }): ReactElement => {
    return (
        <div className="flex items-center gap-0.5" role="radiogroup" aria-label="Solo mode">
            {SOLO_MODES.map((m) => (
                <Tooltip key={m.value}>
                    <TooltipTrigger asChild>
                        <Button
                            variant={soloMode === m.value ? "secondary" : "ghost"}
                            size="xs"
                            role="radio"
                            aria-checked={soloMode === m.value}
                            onClick={() => setSoloMode(m.value)}
                        >
                            {m.label}
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>{m.description}</TooltipContent>
                </Tooltip>
            ))}
        </div>
    );
};

const UndoRedoButtons = ({ canUndo, canRedo }: { canUndo: boolean; canRedo: boolean }): ReactElement => {
    return (
        <div className="flex items-center gap-0.5" role="group" aria-label="Undo/Redo">
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label="Undo" disabled={!canUndo} onClick={() => void undo()}>
                        <Undo2 className="size-3.5" aria-hidden="true" />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>Undo (⌘Z)</TooltipContent>
            </Tooltip>
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label="Redo" disabled={!canRedo} onClick={() => void redo()}>
                        <Redo2 className="size-3.5" aria-hidden="true" />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>Redo (⌘⇧Z)</TooltipContent>
            </Tooltip>
        </div>
    );
};

const WorkspaceModeSelector = ({ mode }: { mode: WorkspaceMode }): ReactElement => {
    const modes: { value: WorkspaceMode; label: string }[] = [
        { value: "arrange", label: "Arrange" },
        { value: "clip", label: "Clip" },
        { value: "mix", label: "Mix" },
    ];

    return (
        <div className="flex items-center gap-0.5" role="radiogroup" aria-label="Workspace mode">
            {modes.map((m) => (
                <Button
                    key={m.value}
                    variant={mode === m.value ? "secondary" : "ghost"}
                    size="xs"
                    role="radio"
                    aria-checked={mode === m.value}
                    onClick={() => setWorkspaceMode(m.value)}
                >
                    {m.label}
                </Button>
            ))}
        </div>
    );
};

const VoiceButton = (): ReactElement => {
    const handleClick = () => {
        document.dispatchEvent(new CustomEvent("webdaw:toggle-voice-command"));
    };

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Voice command (hold V)" onClick={handleClick}>
                    <Mic className="size-3.5" aria-hidden="true" />
                </Button>
            </TooltipTrigger>
            <TooltipContent>Voice command (hold V)</TooltipContent>
        </Tooltip>
    );
};

const PanelToggles = ({
    sidebarOpen,
    inspectorOpen,
    mixerOpen,
}: {
    sidebarOpen: boolean;
    inspectorOpen: boolean;
    mixerOpen: boolean;
}): ReactElement => {
    return (
        <div className="flex items-center gap-0.5" role="group" aria-label="Panel toggles">
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label="Toggle browser" aria-pressed={sidebarOpen} onClick={toggleSidebar}>
                        <PanelLeft className="size-3.5" aria-hidden="true" />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>Toggle Browser</TooltipContent>
            </Tooltip>
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label="Toggle inspector" aria-pressed={inspectorOpen} onClick={toggleInspector}>
                        <PanelRight className="size-3.5" aria-hidden="true" />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>Toggle Inspector</TooltipContent>
            </Tooltip>
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label="Toggle mixer" aria-pressed={mixerOpen} onClick={toggleMixer}>
                        <LayoutPanelTop className="size-3.5" aria-hidden="true" />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>Toggle Mixer</TooltipContent>
            </Tooltip>
        </div>
    );
};

const ProjectName = ({ name, dirty }: { name: string; dirty: boolean }): ReactElement => {
    const [editing, setEditing] = useState(false);
    const [value, setValue] = useState(name);

    const commit = () => {
        if (value.trim() && value !== name) {
            renameProject(value.trim());
        }
        setEditing(false);
    };

    if (editing) {
        return (
            <input
                className="h-6 w-32 rounded bg-surface-overlay px-1.5 text-xs text-foreground outline-none ring-1 ring-ring"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                    if (e.key === "Enter") commit();
                    if (e.key === "Escape") setEditing(false);
                }}
                autoFocus
            />
        );
    }

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <button
                    className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-foreground hover:bg-accent truncate max-w-36"
                    onClick={() => { setEditing(true); setValue(name); }}
                    onDoubleClick={() => saveProject()}
                >
                    <span className="truncate">{name}</span>
                    {dirty && <span className="text-muted-foreground">•</span>}
                </button>
            </TooltipTrigger>
            <TooltipContent>Click to rename, double-click to save</TooltipContent>
        </Tooltip>
    );
};

const toggleTimeDisplayMode = (): void => {
    const current = workspaceStore.value;
    if (!current) {
        return;
    }
    workspaceStore.set({
        ...current,
        timeDisplayMode: current.timeDisplayMode === "musical" ? "time" : "musical",
    });
};

const PlayheadDisplay = ({ position, tempo, numerator, timeDisplayMode }: { position: number; tempo: number; numerator: number; timeDisplayMode: TimeDisplayMode }): ReactElement => {
    const isMusical = timeDisplayMode === "musical";

    if (isMusical) {
        const bar = Math.floor(position / numerator) + 1;
        const beat = Math.floor(position % numerator) + 1;
        const tick = Math.floor((position % 1) * 480);

        return (
            <Tooltip>
                <TooltipTrigger asChild>
                    <button
                        className="flex items-center gap-0.5 font-mono tabular-nums rounded px-1.5 py-0.5 hover:bg-accent transition-colors"
                        onClick={toggleTimeDisplayMode}
                        aria-label="Playhead position — click to switch to wall-clock time"
                    >
                        <span className="text-[7px] text-muted-foreground/60 uppercase mr-1 font-sans">Bars</span>
                        <span className="text-xs text-foreground min-w-5 text-right">{bar}</span>
                        <span className="text-[10px] text-muted-foreground">:</span>
                        <span className="text-xs text-foreground min-w-3">{beat}</span>
                        <span className="text-[10px] text-muted-foreground">:</span>
                        <span className="text-[10px] text-muted-foreground min-w-6">{String(tick).padStart(3, "0")}</span>
                    </button>
                </TooltipTrigger>
                <TooltipContent>Click to switch to wall-clock time</TooltipContent>
            </Tooltip>
        );
    }

    const seconds = position / (tempo / 60);
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <button
                    className="flex items-center gap-0.5 font-mono tabular-nums rounded px-1.5 py-0.5 hover:bg-accent transition-colors"
                    onClick={toggleTimeDisplayMode}
                    aria-label="Playhead position — click to switch to bars and beats"
                >
                    <span className="text-[7px] text-muted-foreground/60 uppercase mr-1 font-sans">Time</span>
                    <span className="text-xs text-foreground min-w-5 text-right">{String(mins).padStart(2, "0")}</span>
                    <span className="text-[10px] text-muted-foreground">:</span>
                    <span className="text-xs text-foreground min-w-4">{String(secs).padStart(2, "0")}</span>
                    <span className="text-[10px] text-muted-foreground">.</span>
                    <span className="text-[10px] text-muted-foreground min-w-6">{String(ms).padStart(3, "0")}</span>
                </button>
            </TooltipTrigger>
            <TooltipContent>Click to switch to bars &amp; beats</TooltipContent>
        </Tooltip>
    );
};

const AiStatusIndicator = (): ReactElement => {
    const aiState = useAiRuntimeState();

    const statusColor: Record<string, string> = {
        idle: "bg-muted-foreground/50",
        loading: "bg-yellow-500 animate-pulse",
        processing: "bg-blue-500 animate-pulse",
        ready: "bg-emerald-500",
        error: "bg-red-500",
    };

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <div className="flex items-center gap-1 px-1 cursor-default" aria-live="polite" aria-label={`AI status: ${aiState.status}`}>
                    <div className={cn("size-1.5 rounded-full", statusColor[aiState.status] ?? "bg-muted-foreground/50")} aria-hidden="true" />
                    <span className="text-xs text-muted-foreground">AI</span>
                </div>
            </TooltipTrigger>
            <TooltipContent>
                AI: {aiState.status}{aiState.lastError ? ` — ${aiState.lastError}` : ""}
            </TooltipContent>
        </Tooltip>
    );
};
