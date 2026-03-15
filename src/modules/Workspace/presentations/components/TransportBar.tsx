import { type ReactElement } from "react";
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
} from "lucide-react";
import { Button } from "#/components/ui/button";
import { Separator } from "#/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "#/components/ui/tooltip";
import { cn } from "#/helpers/Styles/cn";
import { useWorkspaceState } from "../hooks/useWorkspaceState";
import { useTransportState } from "#/modules/Transport/presentations/hooks/useTransportState";
import { useUndoState } from "#/modules/Command/presentations/hooks/useUndoState";
import { setWorkspaceMode } from "../../useCases/setWorkspaceMode";
import { toggleSidebar, toggleInspector, toggleMixer } from "../../useCases/togglePanel";
import { togglePlayback, stopPlayback, toggleLoop, toggleMetronome, toggleRecording } from "#/modules/Transport/useCases/transportControls";
import { undo, redo } from "#/modules/Command/useCases/undoRedo";
import { PromptBar } from "./PromptBar";
import { ToolSelector } from "./ToolSelector";
import { TempoEditor } from "./TempoEditor";
import type { WorkspaceMode } from "../../models/WorkspaceState";
import { Undo2, Redo2 } from "lucide-react";

export const TransportBar = (): ReactElement => {
    const { mode, sidebarOpen, inspectorOpen, mixerOpen } = useWorkspaceState();
    const transport = useTransportState();
    const undoState = useUndoState();

    return (
        <header
            className="flex h-(--spacing-transport-height) shrink-0 items-center gap-1 border-b border-border bg-surface-raised px-2"
            role="toolbar"
            aria-label="Transport controls"
        >
            <TransportControls isPlaying={transport.isPlaying} isRecording={transport.isRecording} isLooping={transport.isLooping} metronomeEnabled={transport.metronomeEnabled} />

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
}: {
    isPlaying: boolean;
    isRecording: boolean;
    isLooping: boolean;
    metronomeEnabled: boolean;
}): ReactElement => {
    return (
        <div className="flex items-center gap-0.5" role="group" aria-label="Playback controls">
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
                    <Button variant={isRecording ? "secondary" : "ghost"} size="icon-sm" aria-label={isRecording ? "Stop recording" : "Record"} aria-pressed={isRecording} onClick={toggleRecording}>
                        <Circle className={cn("size-3.5 text-red-500", isRecording && "fill-red-500 animate-pulse")} aria-hidden="true" />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>Record (R)</TooltipContent>
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
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Voice command (hold V)">
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

const AiStatusIndicator = (): ReactElement => {
    return (
        <div className="flex items-center gap-1 px-1" aria-live="polite" aria-label="AI status">
            <div className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
            <span className="text-xs text-muted-foreground">AI</span>
        </div>
    );
};
