import {
    type ReactElement,
    type KeyboardEvent,
    useState,
    useRef,
    useEffect,
    useSyncExternalStore,
    type FormEvent,
} from 'react';
import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Input } from '#/components/ui/input';
import { Button } from '#/components/ui/button';
import {
    Sparkles,
    Check,
    X,
    Brain,
    Zap,
    History,
    Music,
    Disc3,
    AudioLines,
    Play,
    Layers,
    Piano,
    Cable,
    Wand2,
    LayoutDashboard,
    Sliders,
    GitBranch,
    FolderOpen,
    Users,
    AlertTriangle,
} from 'lucide-react';
import { parsePromptToActions, isComplexPrompt } from '../../useCases/workspaceViewActions';
import { getProjectContext } from '../../useCases/workspaceViewActions';
import { searchPresets, getAvailablePresets, type FuzzyResult } from '../../useCases/workspaceViewActions';
import { onPromptInjection } from '#/modules/AiRuntime/presentations/views/VoiceCommandOverlay';
import { executeAppAction } from '../../useCases/workspaceViewActions';
import { notifyAiChange } from '#/modules/AiRuntime/presentations/views/AiChangeToast';
import { isLlmAvailable, initEngine } from '../../useCases/workspaceViewActions';
import { llmStatusStore } from '#/modules/AiRuntime/stores/llmStatusStore';
import { LlmStatusBadge } from './prompt/LlmStatusBadge';
import { generateGroupId } from '../../useCases/workspaceViewActions';
import {
    pushAiActionGroup,
    toggleAiHistoryPanel,
    type AiActionGroup,
} from '#/modules/AiRuntime/stores/aiActionHistoryStore';
import { trackStore } from '#/modules/Track/stores/trackStore';
import { workspaceStore } from '#/modules/Workspace/stores/workspaceStore';
import { appendChatMessage } from '#/modules/AiRuntime/stores/chatStore';
import { type AppAction } from '../../useCases/workspaceViewActions';
import { describeAction } from '../../useCases/workspaceViewActions';
import { type IntentResult } from '../../useCases/workspaceViewActions';
import { type PresetCategory, type PresetContext } from '../../useCases/workspaceViewActions';

const logger = Container.getInstance().get(Logger);

// ── Category icons ──────────────────────────────────────────────────────

const CATEGORY_ICONS: Record<PresetCategory, typeof Play> = {
    Transport: Play,
    Track: Layers,
    Clip: Music,
    MIDI: Piano,
    Device: Cable,
    Generate: Wand2,
    Workspace: LayoutDashboard,
    Mix: Sliders,
    Automation: GitBranch,
    File: FolderOpen,
    Collaboration: Users,
};

// ── Selection tag types ─────────────────────────────────────────────────

type SelectionTag = {
    id: string;
    label: string;
    kind: 'track' | 'clip' | 'clips';
    icon: 'track' | 'clip' | 'clips';
};

const TAG_ICONS = {
    track: AudioLines,
    clip: Music,
    clips: Disc3,
} as const;

// ── Sub-components ──────────────────────────────────────────────────────

const SelectionTagChip = ({ tag, onRemove }: { tag: SelectionTag; onRemove: () => void }): ReactElement => {
    const Icon = TAG_ICONS[tag.icon];
    return (
        <span className="inline-flex items-center gap-1 rounded-md bg-purple-500/15 border border-purple-500/30 px-1.5 py-0.5 text-[10px] text-purple-300 shrink-0">
            <Icon className="size-2.5" aria-hidden="true" />
            <span className="truncate max-w-20">{tag.label}</span>
            <button
                type="button"
                onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onRemove();
                }}
                className="ml-0.5 hover:text-purple-100 transition-colors"
                aria-label={`Remove ${tag.label} from context`}
            >
                <X className="size-2.5" />
            </button>
        </span>
    );
};

const FuzzyResultItem = ({
    result,
    isSelected,
    onExecute,
}: {
    result: FuzzyResult;
    isSelected: boolean;
    onExecute: () => void;
}): ReactElement => {
    const Icon = CATEGORY_ICONS[result.preset.category] ?? Zap;
    return (
        <button
            type="button"
            className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-xs transition-colors ${
                isSelected
                    ? 'bg-accent/60 text-foreground'
                    : 'text-muted-foreground hover:bg-accent/30 hover:text-foreground'
            }`}
            onMouseDown={(e) => {
                e.preventDefault();
                onExecute();
            }}
            role="option"
            aria-selected={isSelected}
        >
            <Icon className="size-3.5 shrink-0 opacity-60" aria-hidden="true" />
            <span className="flex-1 text-left truncate">{result.preset.label}</span>
            {result.preset.isDestructive ? (
                <AlertTriangle className="size-3 text-amber-400 shrink-0" aria-label="Destructive action" />
            ) : null}
            <span className="text-[9px] text-muted-foreground/60 px-1 py-0.5 rounded bg-surface-overlay/50 shrink-0">
                {result.preset.category}
            </span>
        </button>
    );
};

// ── Store subscriptions (module-scope for stable references) ────────────

const subscribeLlm = (cb: () => void): (() => void) => llmStatusStore.subscribe(() => cb());
const getLlmSnapshot = (): typeof llmStatusStore.value => llmStatusStore.value;
const subscribeTrack = (cb: () => void): (() => void) => trackStore.subscribe(cb);
const getTrackSnapshot = () => trackStore.value;
const subscribeWs = (cb: () => void): (() => void) => workspaceStore.subscribe(cb);
const getWsSnapshot = () => workspaceStore.value;

// ── Main component ──────────────────────────────────────────────────────

export const PromptBar = (): ReactElement => {
    const [value, setValue] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [preview, setPreview] = useState<IntentResult | null>(null);
    const [fuzzyResults, setFuzzyResults] = useState<FuzzyResult[]>([]);
    const [selectedIndex, setSelectedIndex] = useState(-1);
    const [dismissedTags, setDismissedTags] = useState<Set<string>>(new Set());
    const [isFocused, setIsFocused] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const formRef = useRef<HTMLFormElement>(null);
    const abortRef = useRef<AbortController | null>(null);
    const pendingSubmitRef = useRef(false);

    const llmStatus = useSyncExternalStore(subscribeLlm, getLlmSnapshot, getLlmSnapshot);
    const trackState = useSyncExternalStore(subscribeTrack, getTrackSnapshot);
    const wsState = useSyncExternalStore(subscribeWs, getWsSnapshot);

    // ── Derive selection tags ───────────────────────────────────────────
    const selectionTags: SelectionTag[] = [];
    const selectedTrackId = trackState?.selectedTrackId;
    const selectedClipId = wsState?.selectedClipId;
    const selectedClipIds = wsState?.selectedClipIds ?? [];

    if (selectedTrackId) {
        const track = trackState?.tracks.find((t) => t.id === selectedTrackId);
        if (track && !dismissedTags.has(`track:${selectedTrackId}`)) {
            selectionTags.push({ id: `track:${selectedTrackId}`, label: track.name, kind: 'track', icon: 'track' });
        }
    }
    if (selectedClipIds.length > 1) {
        const key = `clips:${selectedClipIds.length}`;
        if (!dismissedTags.has(key)) {
            selectionTags.push({ id: key, label: `${selectedClipIds.length} clips`, kind: 'clips', icon: 'clips' });
        }
    } else if (selectedClipId) {
        const allClips = trackState?.tracks.flatMap((t) => t.clips) ?? [];
        const clip = allClips.find((c) => c.id === selectedClipId);
        if (clip && !dismissedTags.has(`clip:${selectedClipId}`)) {
            selectionTags.push({ id: `clip:${selectedClipId}`, label: clip.name, kind: 'clip', icon: 'clip' });
        }
    }

    // ── Build preset context ────────────────────────────────────────────
    const presetContext: PresetContext = {
        selectedTrackId: selectedTrackId ?? undefined,
        selectedClipId: selectedClipId ?? undefined,
        selectedClipType: (() => {
            const allClips = trackState?.tracks.flatMap((t) => t.clips) ?? [];
            const clip = allClips.find((c) => c.id === selectedClipId);
            return clip?.type;
        })(),
        trackCount: trackState?.tracks.length ?? 0,
    };

    // ── Reset dismissed tags when selection changes ─────────────────────
    useEffect(() => {
        setDismissedTags(new Set());
    }, [selectedTrackId, selectedClipId, selectedClipIds]);

    // ── Voice injection (auto-submit after setting value) ────────────────
    useEffect(() => {
        return onPromptInjection((text) => {
            setValue((prev) => (prev ? `${prev} ${text}` : text));
            pendingSubmitRef.current = true;
            inputRef.current?.focus();
        });
    }, []);

    // ── pending submit after value change ───────────────────────────────
    useEffect(() => {
        if (pendingSubmitRef.current && value.trim().length > 0) {
            pendingSubmitRef.current = false;
            formRef.current?.requestSubmit();
        }
    }, [value]);

    // ── Fuzzy search on input change ────────────────────────────────────
    useEffect(() => {
        if (preview || isProcessing) {
            setFuzzyResults([]);
            return;
        }
        if (!isFocused) {
            setFuzzyResults([]);
            return;
        }

        const trimmed = value.trim();
        if (trimmed.length === 0) {
            // Show top available presets when focused with no input
            const available = getAvailablePresets(presetContext);
            setFuzzyResults(available.slice(0, 10).map((preset) => ({ preset, score: 0 })));
        } else {
            const results = searchPresets(trimmed, presetContext, 10);
            setFuzzyResults(results);
        }
        setSelectedIndex(-1);
    }, [value, preview, isFocused, isProcessing, trackState, wsState]);

    // ── Execute preset directly ─────────────────────────────────────────
    const executePreset = async (result: FuzzyResult) => {
        const actionResult = result.preset.buildAction(presetContext);
        if (!actionResult) {
            return;
        }
        const actions = Array.isArray(actionResult) ? actionResult : [actionResult];

        // Handle destructive actions
        if (result.preset.isDestructive) {
            setPreview({
                actions,
                confidence: 0.95,
                rawText: result.preset.label,
                requiresConfirmation: true,
            });
            setValue(result.preset.label);
            setFuzzyResults([]);
            return;
        }

        setFuzzyResults([]);
        setIsProcessing(true);
        try {
            await executeWithGroup(actions, result.preset.label);
            if (actions.length > 0) {
                notifyAiChange(
                    `Executed: ${result.preset.label}`,
                    actions.map((a) => a.type)
                );
            }
        } catch (error) {
            logger.error(new Error('Preset execution failed', { cause: error }));
        } finally {
            setIsProcessing(false);
            setValue('');
        }
    };

    // ── Execute action group ────────────────────────────────────────────
    const executeWithGroup = async (actions: AppAction[], prompt: string) => {
        const group = generateGroupId(prompt);
        const executedLabels: Array<{ action: AppAction; label: string }> = [];

        for (const action of actions) {
            await executeAppAction(action, { ...group, source: 'prompt' });
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

    // ── Full prompt submission (for complex / LLM) ──────────────────────
    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (!value.trim() || isProcessing) {
            return;
        }

        setFuzzyResults([]);
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
                    result.actions.map((a) => a.type)
                );
            } else {
                notifyAiChange(`No actions matched: "${value}"`, []);
                appendChatMessage({
                    id: crypto.randomUUID(),
                    role: 'user',
                    content: value,
                    timestamp: Date.now(),
                });
                appendChatMessage({
                    id: crypto.randomUUID(),
                    role: 'assistant',
                    content:
                        "I couldn't identify any DAW commands in that prompt. If you're looking for help, try the AI Chat panel; if you're trying to execute an action, try rephrasing.",
                    error: 'No actionable commands found',
                    timestamp: Date.now(),
                });
            }
        } catch (error) {
            logger.error(new Error('Prompt execution failed', { cause: error }));
        } finally {
            abortRef.current = null;
            setIsProcessing(false);
            if (!preview) {
                setValue('');
            }
        }
    };

    const confirmPreview = async () => {
        if (!preview) {
            return;
        }
        await executeWithGroup(preview.actions, value);
        notifyAiChange(
            `Confirmed: ${value}`,
            preview.actions.map((a) => a.type)
        );
        setPreview(null);
        setValue('');
    };

    const cancelPreview = () => {
        setPreview(null);
    };

    // ── Keyboard navigation ─────────────────────────────────────────────
    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (fuzzyResults.length > 0) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedIndex((prev) => Math.min(prev + 1, fuzzyResults.length - 1));
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedIndex((prev) => Math.max(prev - 1, -1));
            } else if (e.key === 'Tab' && selectedIndex >= 0) {
                e.preventDefault();
                const selected = fuzzyResults[selectedIndex];
                if (selected) {
                    setValue(selected.preset.label);
                    setFuzzyResults([]);
                }
            } else if (e.key === 'Enter' && selectedIndex >= 0) {
                e.preventDefault();
                const selected = fuzzyResults[selectedIndex];
                if (selected) {
                    void executePreset(selected);
                }
            } else if (e.key === 'Escape') {
                e.preventDefault();
                setFuzzyResults([]);
                setSelectedIndex(-1);
            }
        }
    };

    const handleLoadModel = () => {
        if (isLlmAvailable()) {
            void initEngine();
        }
    };

    const willUseLlm = value.trim().length > 0 && isComplexPrompt(value.toLowerCase().trim());

    // ── Preview mode ────────────────────────────────────────────────────
    if (preview) {
        return (
            <div className="flex items-center gap-2 max-w-lg">
                <Sparkles className="size-3.5 shrink-0 text-yellow-400" aria-hidden="true" />
                <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap gap-1">
                        {preview.actions.map((a: AppAction, i: number) => (
                            <span
                                key={i}
                                className="inline-flex items-center rounded bg-accent/50 px-1.5 py-0.5 text-[10px] text-foreground"
                            >
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

    // ── Main render ─────────────────────────────────────────────────────
    return (
        <div className="relative flex-1 max-w-lg">
            <form ref={formRef} onSubmit={handleSubmit} className="flex items-center gap-1.5">
                {isProcessing ? (
                    <Button
                        size="icon-xs"
                        variant="ghost"
                        type="button"
                        aria-label="Cancel AI processing"
                        onClick={() => {
                            abortRef.current?.abort();
                            abortRef.current = null;
                            setIsProcessing(false);
                        }}
                    >
                        <X className="size-3 text-destructive-foreground" />
                    </Button>
                ) : willUseLlm ? (
                    <Brain className="size-3.5 shrink-0 text-purple-400" aria-hidden="true" />
                ) : (
                    <Zap className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                )}
                {isFocused
                    ? selectionTags.map((tag) => (
                          <SelectionTagChip
                              key={tag.id}
                              tag={tag}
                              onRemove={() => setDismissedTags((prev) => new Set([...prev, tag.id]))}
                          />
                      ))
                    : null}
                <Input
                    ref={inputRef}
                    type="text"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onFocus={() => setIsFocused(true)}
                    onBlur={() => {
                        // Delay to allow clicking dropdown items
                        setTimeout(() => setIsFocused(false), 200);
                    }}
                    placeholder={
                        isProcessing
                            ? llmStatus?.state === 'generating'
                                ? 'AI is thinking...'
                                : 'Processing...'
                            : selectionTags.length > 0
                              ? 'What do you want to do with this?'
                              : 'Type a command... (⌘K for palette)'
                    }
                    className="h-7 border-0 bg-transparent text-xs shadow-none focus-visible:ring-0 placeholder:text-muted-foreground/60"
                    aria-label="Prompt command input"
                    aria-autocomplete="list"
                    aria-expanded={fuzzyResults.length > 0}
                    aria-controls="prompt-results"
                    disabled={isProcessing}
                />
                <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={toggleAiHistoryPanel}
                    title="AI action history"
                    aria-label="Toggle AI action history"
                    type="button"
                >
                    <History className="size-3.5" />
                </Button>
                <LlmStatusBadge status={llmStatus ?? { state: 'idle' }} onLoad={handleLoadModel} />
            </form>

            {fuzzyResults.length > 0 ? (
                <div
                    id="prompt-results"
                    role="listbox"
                    aria-label="Command suggestions"
                    className="absolute top-full left-0 right-0 mt-1 z-50 rounded-md border border-border bg-popover shadow-lg py-1 max-h-80 overflow-y-auto"
                >
                    {value.trim().length === 0 ? (
                        <div className="px-3 py-1 text-[9px] uppercase tracking-wider text-muted-foreground/50 font-medium">
                            Available commands
                        </div>
                    ) : null}
                    {fuzzyResults.map((result, i) => (
                        <FuzzyResultItem
                            key={result.preset.id}
                            result={result}
                            isSelected={i === selectedIndex}
                            onExecute={() => void executePreset(result)}
                        />
                    ))}
                    {value.trim().length > 0 && fuzzyResults.length === 0 ? (
                        <div className="px-3 py-2 text-xs text-muted-foreground/60 italic">
                            No matching commands — press Enter to try AI
                        </div>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
};
