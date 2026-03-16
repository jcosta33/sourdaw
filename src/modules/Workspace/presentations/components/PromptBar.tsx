import { type ReactElement, type KeyboardEvent, useState, useRef, useEffect, useSyncExternalStore, type FormEvent, useMemo } from "react";
import { Container } from "#/helpers/DependencyInjector/Container";
import { Logger } from "#/helpers/Logger/Logger";
import { Input } from "#/components/ui/input";
import { Button } from "#/components/ui/button";
import { Sparkles, Loader2, Check, X, Brain, Zap, History, Music, Disc3, AudioLines } from "lucide-react";
import { parsePromptToActions, isComplexPrompt } from "#/modules/AiRuntime/useCases/parsePromptToActions";
import { getProjectContext } from "#/modules/AiRuntime/useCases/getProjectContext";
import { generateSuggestions } from "#/modules/AiRuntime/useCases/smartSuggestions";
import { onPromptInjection } from "#/modules/AiRuntime/presentations/components/VoiceCommandOverlay";
import { executeAppAction } from "#/modules/Command/useCases/executeAppAction";
import { notifyAiChange } from "#/modules/AiRuntime/presentations/components/AiChangeToast";
import { llmStatusStore, initLlmEngine, isLlmAvailable } from "#/modules/AiRuntime/repositories/webLlmEngine";
import { generateGroupId } from "#/modules/Command/models/UndoEntry";
import { pushAiActionGroup, toggleAiHistoryPanel, type AiActionGroup } from "#/modules/AiRuntime/stores/aiActionHistoryStore";
import { trackStore } from "#/modules/Track/stores/trackStore";
import { workspaceStore } from "#/modules/Workspace/stores/workspaceStore";
import type { AppAction } from "#/modules/Command/models/AppAction";
import type { IntentResult } from "#/modules/AiRuntime/models/IntentResult";

const logger = Container.getInstance().get(Logger);

type SelectionTag = {
    id: string;
    label: string;
    kind: "track" | "clip" | "clips";
    icon: "track" | "clip" | "clips";
};

const ACTION_LABELS: Record<string, string> = {
    addTrack: "Add track",
    removeTrack: "Remove track",
    renameTrack: "Rename track",
    selectTrack: "Select track",
    muteTrack: "Mute/unmute",
    soloTrack: "Solo/unsolo",
    armTrack: "Arm/disarm",
    reorderTrack: "Reorder track",
    setTempo: "Set tempo",
    togglePlayback: "Play/pause",
    stopPlayback: "Stop",
    toggleRecording: "Record",
    setLoopRegion: "Set loop",
    addClip: "Add clip",
    addDevice: "Add device",
    setDeviceParameter: "Set parameter",
    setTrackGain: "Set gain",
    setTrackPan: "Set pan",
    setTrackColor: "Set color",
    setWorkspaceMode: "Switch view",
    toggleSidebar: "Toggle sidebar",
    toggleInspector: "Toggle inspector",
    setEditingTool: "Set tool",
    duplicateClip: "Duplicate clip",
    removeClip: "Remove clip",
    trimClipStart: "Trim start",
    trimClipEnd: "Trim end",
    quantizeNotes: "Quantize",
    transposeNotes: "Transpose",
    humanizeNotes: "Humanize",
    invertNotes: "Invert notes",
    retrogradeNotes: "Retrograde",
    createBus: "Create bus",
    createFolder: "Create folder",
    addSection: "Add section",
    renameSection: "Rename section",
    addAutomationLane: "Add automation",
    addAutomationPoint: "Set automation",
};

const describeAction = (action: AppAction): string => {
    const base = ACTION_LABELS[action.type] ?? action.type;
    const p = action.payload as Record<string, unknown> | undefined;
    if (!p) return base;
    if ("name" in p && typeof p.name === "string") return `${base}: ${p.name}`;
    if ("bpm" in p) return `${base}: ${p.bpm} BPM`;
    if ("kind" in p) return `${base} (${p.kind})`;
    if ("deviceType" in p) return `${base}: ${p.deviceType}`;
    if ("paramId" in p && "value" in p) return `${base}: ${p.paramId} = ${p.value}`;
    if ("semitones" in p) return `${base}: ${(p.semitones as number) > 0 ? "+" : ""}${p.semitones}st`;
    if ("gain" in p) return `${base}: ${Math.round((p.gain as number) * 100)}%`;
    if ("tool" in p) return `${base}: ${p.tool}`;
    return base;
};

const TAG_ICONS = {
    track: AudioLines,
    clip: Music,
    clips: Disc3,
} as const;

const SelectionTagChip = ({ tag, onRemove }: { tag: SelectionTag; onRemove: () => void }): ReactElement => {
    const Icon = TAG_ICONS[tag.icon];
    return (
        <span className="inline-flex items-center gap-1 rounded-md bg-purple-500/15 border border-purple-500/30 px-1.5 py-0.5 text-[10px] text-purple-300 shrink-0">
            <Icon className="size-2.5" aria-hidden="true" />
            <span className="truncate max-w-20">{tag.label}</span>
            <button
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemove(); }}
                className="ml-0.5 hover:text-purple-100 transition-colors"
                aria-label={`Remove ${tag.label} from context`}
            >
                <X className="size-2.5" />
            </button>
        </span>
    );
};

export const PromptBar = (): ReactElement => {
    const [value, setValue] = useState("");
    const [isProcessing, setIsProcessing] = useState(false);
    const [preview, setPreview] = useState<IntentResult | null>(null);
    const [suggestions, setSuggestions] = useState<string[]>([]);
    const [selectedSuggestion, setSelectedSuggestion] = useState(-1);
    const [dismissedTags, setDismissedTags] = useState<Set<string>>(new Set());
    const inputRef = useRef<HTMLInputElement>(null);
    const formRef = useRef<HTMLFormElement>(null);
    const abortRef = useRef<AbortController | null>(null);
    const pendingSubmitRef = useRef(false);

    const llmStatus = useSyncExternalStore(
        (cb) => llmStatusStore.subscribe(() => cb()),
        () => llmStatusStore.value,
        () => llmStatusStore.value,
    );

    const trackState = useSyncExternalStore(
        (cb) => trackStore.subscribe(cb),
        () => trackStore.value,
    );
    const wsState = useSyncExternalStore(
        (cb) => workspaceStore.subscribe(cb),
        () => workspaceStore.value,
    );

    const selectionTags = useMemo((): SelectionTag[] => {
        const tags: SelectionTag[] = [];
        const selectedTrackId = trackState?.selectedTrackId;
        const selectedClipId = wsState?.selectedClipId;
        const selectedClipIds = wsState?.selectedClipIds ?? [];

        if (selectedTrackId) {
            const track = trackState?.tracks.find((t) => t.id === selectedTrackId);
            if (track && !dismissedTags.has(`track:${selectedTrackId}`)) {
                tags.push({ id: `track:${selectedTrackId}`, label: track.name, kind: "track", icon: "track" });
            }
        }

        if (selectedClipIds.length > 1) {
            const key = `clips:${selectedClipIds.length}`;
            if (!dismissedTags.has(key)) {
                tags.push({ id: key, label: `${selectedClipIds.length} clips`, kind: "clips", icon: "clips" });
            }
        } else if (selectedClipId) {
            const allClips = trackState?.tracks.flatMap((t) => t.clips) ?? [];
            const clip = allClips.find((c) => c.id === selectedClipId);
            if (clip && !dismissedTags.has(`clip:${selectedClipId}`)) {
                tags.push({ id: `clip:${selectedClipId}`, label: clip.name, kind: "clip", icon: "clip" });
            }
        }

        return tags;
    }, [trackState, wsState, dismissedTags]);

    useEffect(() => {
        setDismissedTags(new Set());
    }, [trackState?.selectedTrackId, wsState?.selectedClipId, wsState?.selectedClipIds]);

    useEffect(() => {
        return onPromptInjection((text) => {
            setValue((prev) => (prev ? `${prev} ${text}` : text));
            inputRef.current?.focus();
        });
    }, []);

    const [isFocused, setIsFocused] = useState(false);

    useEffect(() => {
        if (pendingSubmitRef.current && value.trim().length > 0) {
            pendingSubmitRef.current = false;
            formRef.current?.requestSubmit();
        }
    }, [value]);

    useEffect(() => {
        if (preview) {
            setSuggestions([]);
            return;
        }
        if (value.trim().length === 0 && isFocused) {
            const ctx = getProjectContext();
            setSuggestions(generateSuggestions(ctx));
            setSelectedSuggestion(-1);
        } else {
            setSuggestions([]);
        }
    }, [value, preview, isFocused, trackState, wsState]);

    const executeWithGroup = async (actions: AppAction[], prompt: string) => {
        const group = generateGroupId(prompt);
        const executedLabels: Array<{ action: AppAction; label: string }> = [];

        for (const action of actions) {
            await executeAppAction(action, { ...group, source: "prompt" });
            executedLabels.push({ action, label: describeAction(action) });
        }

        if (actions.length > 0) {
            const historyGroup: AiActionGroup = {
                id: group.groupId,
                prompt,
                actions: executedLabels,
                groupId: group.groupId,
                timestamp: Date.now(),
                reverted: false,
            };
            pushAiActionGroup(historyGroup);
        }
    };

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (!value.trim() || isProcessing) return;

        setSuggestions([]);
        setIsProcessing(true);
        const controller = new AbortController();
        abortRef.current = controller;
        try {
            const context = getProjectContext();
            const result = await parsePromptToActions(value, context, controller.signal);

            if (controller.signal.aborted) {
                return;
            }

            if (result.requiresConfirmation && result.actions.length > 0) {
                setPreview(result);
                setIsProcessing(false);
                return;
            }

            await executeWithGroup(result.actions, value);

            if (result.actions.length > 0) {
                notifyAiChange(
                    `Executed: ${value}`,
                    result.actions.map((a) => a.type),
                );
            } else {
                notifyAiChange(`No actions matched: "${value}"`, []);
            }
        } catch (err) {
            logger.error(new Error("Prompt execution failed", { cause: err }));
        } finally {
            abortRef.current = null;
            setIsProcessing(false);
            if (!preview) {
                setValue("");
            }
        }
    };

    const confirmPreview = async () => {
        if (!preview) return;
        await executeWithGroup(preview.actions, value);
        notifyAiChange(
            `Confirmed: ${value}`,
            preview.actions.map((a) => a.type),
        );
        setPreview(null);
        setValue("");
    };

    const cancelPreview = () => {
        setPreview(null);
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (suggestions.length > 0) {
            if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelectedSuggestion((prev) => Math.min(prev + 1, suggestions.length - 1));
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelectedSuggestion((prev) => Math.max(prev - 1, -1));
            } else if (e.key === "Tab" && selectedSuggestion >= 0) {
                e.preventDefault();
                setValue(suggestions[selectedSuggestion]!);
                setSuggestions([]);
            }
        }
    };

    const handleLoadModel = () => {
        if (isLlmAvailable()) void initLlmEngine();
    };

    const willUseLlm = value.trim().length > 0 && isComplexPrompt(value.toLowerCase().trim());

    if (preview) {
        return (
            <div className="flex items-center gap-2 max-w-lg">
                <Sparkles className="size-3.5 shrink-0 text-yellow-400" aria-hidden="true" />
                <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap gap-1">
                        {preview.actions.map((a: AppAction, i: number) => (
                            <span key={i} className="inline-flex items-center rounded bg-accent/50 px-1.5 py-0.5 text-[10px] text-foreground">
                                {describeAction(a)}
                            </span>
                        ))}
                    </div>
                </div>
                <Button size="icon-xs" variant="ghost" onClick={confirmPreview} aria-label="Confirm actions">
                    <Check className="size-3 text-emerald-400" />
                </Button>
                <Button size="icon-xs" variant="ghost" onClick={cancelPreview} aria-label="Cancel actions">
                    <X className="size-3 text-destructive-foreground" />
                </Button>
            </div>
        );
    }

    return (
        <div className="relative flex-1 max-w-lg">
            <form ref={formRef} onSubmit={handleSubmit} className="flex items-center gap-1.5">
                {isProcessing ? (
                    <span className="flex items-center gap-0.5 shrink-0">
                        <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden="true" />
                        <Button
                            size="icon-xs"
                            variant="ghost"
                            aria-label="Cancel AI processing"
                            onClick={() => {
                                abortRef.current?.abort();
                                abortRef.current = null;
                                setIsProcessing(false);
                            }}
                        >
                            <X className="size-3 text-destructive-foreground" />
                        </Button>
                    </span>
                ) : willUseLlm ? (
                    <Brain className="size-3.5 shrink-0 text-purple-400" aria-hidden="true" />
                ) : (
                    <Zap className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                )}
                {selectionTags.map((tag) => (
                    <SelectionTagChip
                        key={tag.id}
                        tag={tag}
                        onRemove={() => setDismissedTags((prev) => new Set([...prev, tag.id]))}
                    />
                ))}
                <Input
                    ref={inputRef}
                    type="text"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onFocus={() => setIsFocused(true)}
                    onBlur={() => setIsFocused(false)}
                    placeholder={isProcessing
                        ? (llmStatus?.state === "generating" ? "AI is thinking..." : "Processing...")
                        : selectionTags.length > 0
                            ? "What do you want to do with this?"
                            : "Type a command... (natural language or ⌘K for palette)"
                    }
                    className="h-7 border-0 bg-transparent text-xs shadow-none focus-visible:ring-0 placeholder:text-muted-foreground/60"
                    aria-label="Prompt command input"
                    aria-autocomplete="list"
                    disabled={isProcessing}
                />
                <button
                    onClick={toggleAiHistoryPanel}
                    className="text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                    title="AI action history"
                    aria-label="Toggle AI action history"
                    type="button"
                >
                    <History className="size-3.5" />
                </button>
                <LlmStatusBadge status={llmStatus} onLoad={handleLoadModel} />
            </form>

            {suggestions.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 z-50 rounded-md border border-border bg-surface-overlay shadow-lg py-1">
                    {suggestions.map((s, i) => (
                        <button
                            key={s}
                            className={`w-full text-left px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent/50 ${i === selectedSuggestion ? "bg-accent/50 text-foreground" : ""}`}
                            onMouseDown={(e) => {
                                e.preventDefault();
                                pendingSubmitRef.current = true;
                                setValue(s);
                                setSuggestions([]);
                                inputRef.current?.focus();
                            }}
                        >
                            {s}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

const LlmStatusBadge = ({ status, onLoad }: { status: typeof llmStatusStore.value; onLoad: () => void }): ReactElement | null => {
    if (!isLlmAvailable()) {
        return (
            <span className="text-[9px] text-muted-foreground/50 whitespace-nowrap" title="WebGPU not available — complex commands disabled">
                No GPU
            </span>
        );
    }

    if (!status || status.state === "idle") {
        return (
            <button
                onClick={onLoad}
                className="text-[9px] text-purple-400/70 hover:text-purple-400 whitespace-nowrap transition-colors"
                title="Click to load AI model for complex natural language commands"
            >
                Load AI
            </button>
        );
    }

    if (status.state === "loading") {
        return (
            <div className="flex items-center gap-1" title={status.text}>
                <Loader2 className="size-3 animate-spin text-purple-400" />
                <span className="text-[9px] text-purple-400 whitespace-nowrap">
                    {Math.round(status.progress * 100)}%
                </span>
            </div>
        );
    }

    if (status.state === "ready") {
        return (
            <span className="text-[9px] text-emerald-400/70 whitespace-nowrap" title="AI model ready">
                AI Ready
            </span>
        );
    }

    if (status.state === "generating") {
        return (
            <div className="flex items-center gap-1">
                <Loader2 className="size-3 animate-spin text-purple-400" />
                <span className="text-[9px] text-purple-400 whitespace-nowrap">Thinking</span>
            </div>
        );
    }

    if (status.state === "error") {
        return (
            <button
                onClick={onLoad}
                className="text-[9px] text-destructive whitespace-nowrap"
                title={status.message}
            >
                AI Error
            </button>
        );
    }

    return null;
};
