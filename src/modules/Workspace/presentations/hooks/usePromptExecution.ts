import {
    type KeyboardEvent,
    type RefObject,
    type FormEvent,
    useState,
    useRef,
    useEffect,
    useSyncExternalStore,
} from 'react';
import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { parsePromptToActions } from '#/modules/AiRuntime/useCases/parsePromptToActions';
import { isComplexPrompt } from '#/modules/AiRuntime/useCases/aiRuntimeQueries';
import { getProjectContext } from '#/modules/AiRuntime/useCases/getProjectContext';
import { searchPresets, type FuzzyResult } from '#/modules/AiRuntime/useCases/aiRuntimeQueries';
import { getAvailablePresets } from '#/modules/AiRuntime/useCases/aiRuntimeQueries';
import { onPromptInjection } from '#/modules/AiRuntime/useCases/promptInjection';
import { executeAppAction } from '#/modules/Command/useCases/executeAppAction';
import { notifyAiChange } from '#/modules/AiRuntime/useCases/notifyAiChange';
import { isLlmAvailable } from '#/modules/AiRuntime/useCases/llmOrchestration/backendResolution';
import { initEngine } from '#/modules/AiRuntime/useCases/llmOrchestration/lifecycle';
import { llmStatusStore } from '#/modules/AiRuntime/stores/llmStatusStore';
import { generateGroupId } from '#/modules/Command/useCases/commandQueries';
import {
    pushAiActionGroup,
    type AiActionGroup,
} from '#/modules/AiRuntime/stores/aiActionHistoryStore';
import { trackStore } from '#/modules/Arrangement/stores/trackStore';
import { workspaceStore } from '#/modules/Workspace/stores/workspaceStore';
import { type AppAction } from '#/modules/Command/useCases/commandQueries';
import { describeAction } from '#/modules/Command/useCases/actionLabels';
import { type IntentResult } from '#/modules/AiRuntime/models/IntentResult';
import { type PresetContext } from '#/modules/AiRuntime/models/presetActions/registry';

const logger = Container.getInstance().get(Logger);

// ── Store subscription helpers ──────────────────────────────────────────

const subscribeLlm = (cb: () => void): (() => void) => llmStatusStore.subscribe(() => cb());
const getLlmSnapshot = (): typeof llmStatusStore.value => llmStatusStore.value;
const subscribeTrack = (cb: () => void): (() => void) => trackStore.subscribe(cb);
const getTrackSnapshot = () => trackStore.value;
const subscribeWs = (cb: () => void): (() => void) => workspaceStore.subscribe(cb);
const getWsSnapshot = () => workspaceStore.value;

// ── Selection tag type ──────────────────────────────────────────────────

export type SelectionTag = {
    id: string;
    label: string;
    kind: 'track' | 'clip' | 'clips';
    icon: 'track' | 'clip' | 'clips';
};

// ── Hook return type ────────────────────────────────────────────────────

export type PromptExecutionState = {
    value: string;
    setValue: (v: string) => void;
    isProcessing: boolean;
    preview: IntentResult | null;
    fuzzyResults: FuzzyResult[];
    selectedIndex: number;
    selectionTags: SelectionTag[];
    isFocused: boolean;
    setIsFocused: (v: boolean) => void;
    willUseLlm: boolean;

    inputRef: RefObject<HTMLInputElement | null>;
    formRef: RefObject<HTMLFormElement | null>;

    llmStatus: typeof llmStatusStore.value;

    handleKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
    handleSubmit: (e: FormEvent) => void;
    executePreset: (result: FuzzyResult) => Promise<void>;
    confirmPreview: () => Promise<void>;
    cancelPreview: () => void;
    cancelProcessing: () => void;
    handleLoadModel: () => void;
    dismissTag: (id: string) => void;
};

/**
 * Encapsulates all prompt bar state, effects, and business logic.
 * The view becomes a pure render function consuming this hook.
 */
export const usePromptExecution = (): PromptExecutionState => {
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

    // ── Pending submit after value change ───────────────────────────────
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
            const available = getAvailablePresets(presetContext);
            setFuzzyResults(available.slice(0, 10).map((preset) => ({ preset, score: 0 })));
        } else {
            const results = searchPresets(trimmed, presetContext, 10);
            setFuzzyResults(results);
        }
        setSelectedIndex(-1);
    }, [value, preview, isFocused, isProcessing, trackState, wsState]);

    // ── Execute action group ────────────────────────────────────────────
    const executeWithGroup = async (actions: AppAction[], prompt: string): Promise<void> => {
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

    // ── Execute preset directly ─────────────────────────────────────────
    const executePreset = async (result: FuzzyResult): Promise<void> => {
        const actionResult = result.preset.buildAction(presetContext);
        if (!actionResult) {
            return;
        }
        const actions = Array.isArray(actionResult) ? actionResult : [actionResult];

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

    // ── Full prompt submission (for complex / LLM) ──────────────────────
    const handleSubmit = async (e: FormEvent): Promise<void> => {
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
                notifyAiChange(
                    "No actions matched. Try rephrasing, or use the AI Chat panel for open-ended help.",
                    []
                );
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

    const confirmPreview = async (): Promise<void> => {
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

    const cancelPreview = (): void => {
        setPreview(null);
    };

    const cancelProcessing = (): void => {
        abortRef.current?.abort();
        abortRef.current = null;
        setIsProcessing(false);
    };

    // ── Keyboard navigation ─────────────────────────────────────────────
    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
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

    const handleLoadModel = (): void => {
        if (isLlmAvailable()) {
            void initEngine();
        }
    };

    const willUseLlm = value.trim().length > 0 && isComplexPrompt(value.toLowerCase().trim());

    const dismissTag = (id: string): void => {
        setDismissedTags((prev) => new Set([...prev, id]));
    };

    return {
        value,
        setValue,
        isProcessing,
        preview,
        fuzzyResults,
        selectedIndex,
        selectionTags,
        isFocused,
        setIsFocused,
        willUseLlm,
        inputRef,
        formRef,
        llmStatus,
        handleKeyDown,
        handleSubmit,
        executePreset,
        confirmPreview,
        cancelPreview,
        cancelProcessing,
        handleLoadModel,
        dismissTag,
    };
};
