import { type KeyboardEvent, type RefObject, type FormEvent, useState, useRef, useEffect } from 'react';

import { logger } from '#/infra/logger/appLogger';
import { useStore } from '#/infra/store/useStore';
import { llmStatusStore } from '#/modules/AiRuntime/stores';
import {
    parsePromptToActions,
    isComplexPrompt,
    getProjectContext,
    searchPresets,
    getAvailablePresets,
    resolvePresetActions,
    onPromptInjection,
    notifyAiChange,
    isLlmAvailable,
    initEngine,
    recordAiActionGroup,
} from '#/modules/AiRuntime/useCases';
import {
    clipSelectionStore,
    defaultClipSelectionState,
    defaultTrackState,
    trackStore,
} from '#/modules/Arrangement/stores';
import { executeAppAction, generateGroupId, describeAction } from '#/modules/Command/useCases';

const defaultLlmStatus: typeof llmStatusStore.value = { state: 'idle' };

// ── Selection tag type ──────────────────────────────────────────────────

export type SelectionTag = {
    id: string;
    label: string;
    kind: 'track' | 'clip' | 'clips';
    icon: 'track' | 'clip' | 'clips';
};

type PromptPresetCategory =
    | 'Transport'
    | 'Track'
    | 'Clip'
    | 'MIDI'
    | 'Device'
    | 'Workspace'
    | 'Mix'
    | 'Generate'
    | 'File'
    | 'Automation'
    | 'Collaboration';

export type PromptFuzzyResult = {
    preset: {
        id: string;
        label: string;
        category: PromptPresetCategory;
        isDestructive: boolean;
    };
    score: number;
};

type PromptAction = ReturnType<typeof resolvePresetActions>[number];

type PromptPreview = {
    actions: PromptAction[];
    actionLabels: string[];
    rawText: string;
    requiresConfirmation: boolean;
    _jsonEditApplied?: boolean;
    _jsonEditSummaries?: string[];
    _jsonEditAttempted?: boolean;
};

// ── Hook return type ────────────────────────────────────────────────────

export type PromptExecutionState = {
    value: string;
    setValue: (v: string) => void;
    isProcessing: boolean;
    preview: PromptPreview | null;
    fuzzyResults: PromptFuzzyResult[];
    selectedIndex: number;
    selectionTags: SelectionTag[];
    isFocused: boolean;
    setIsFocused: (v: boolean) => void;
    willUseLlm: boolean;

    inputRef: RefObject<HTMLInputElement | null>;
    formRef: RefObject<HTMLFormElement | null>;

    llmStatus: typeof llmStatusStore.value;

    handleKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
    handleSubmit: (e: FormEvent) => void | Promise<void>;
    executePreset: (result: PromptFuzzyResult) => Promise<void>;
    confirmPreview: () => Promise<void>;
    cancelPreview: () => void;
    cancelProcessing: () => void;
    handleLoadModel: (modelId?: string) => void;
    dismissTag: (id: string) => void;
};

/**
 * Encapsulates all prompt bar state, effects, and business logic.
 * The view becomes a pure render function consuming this hook.
 */
export const usePromptExecution = (): PromptExecutionState => {
    const [value, setValue] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [preview, setPreview] = useState<PromptPreview | null>(null);
    const [fuzzyResults, setFuzzyResults] = useState<PromptFuzzyResult[]>([]);
    const [selectedIndex, setSelectedIndex] = useState(-1);
    const [dismissedTags, setDismissedTags] = useState<Set<string>>(new Set());
    const [isFocused, setIsFocused] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const formRef = useRef<HTMLFormElement>(null);
    const abortRef = useRef<AbortController | null>(null);
    const pendingSubmitRef = useRef(false);

    const llmStatus = useStore(llmStatusStore, defaultLlmStatus);
    const trackState = useStore(trackStore, defaultTrackState);
    const clipSelection = useStore(clipSelectionStore, defaultClipSelectionState);

    // ── Derive selection tags ───────────────────────────────────────────
    const selectionTags: SelectionTag[] = [];
    const selectedTrackId = trackState?.selectedTrackId;
    const selectedClipId = clipSelection.selectedClipId;
    const selectedClipIds = clipSelection.selectedClipIds;

    if (selectedTrackId) {
        const track = trackState?.tracks.find((time) => time.id === selectedTrackId);
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
        const allClips = trackState?.tracks.flatMap((time) => time.clips) ?? [];
        const clip = allClips.find((context) => context.id === selectedClipId);
        if (clip && !dismissedTags.has(`clip:${selectedClipId}`)) {
            selectionTags.push({ id: `clip:${selectedClipId}`, label: clip.name, kind: 'clip', icon: 'clip' });
        }
    }

    // ── Build preset context ────────────────────────────────────────────
    const presetContext = {
        selectedTrackId: selectedTrackId ?? undefined,
        selectedClipId: selectedClipId ?? undefined,
        selectedClipType: (() => {
            const allClips = trackState?.tracks.flatMap((time) => time.clips) ?? [];
            const clip = allClips.find((context) => context.id === selectedClipId);
            return clip?.type;
        })(),
        trackCount: trackState?.tracks.length ?? 0,
    };

    // ── Reset dismissed tags when selection changes ─────────────────────
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- Resets UI state when selection changes; no cascade risk since deps are external
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
            // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional state clear on mode/focus change; no cascade risk
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
    }, [value, preview, isFocused, isProcessing, trackState, clipSelection]);

    // ── Execute action group ────────────────────────────────────────────
    const executeWithGroup = async (actions: PromptAction[], prompt: string): Promise<void> => {
        const group = generateGroupId(prompt);
        const executedLabels: Array<{ action: PromptAction; label: string }> = [];

        for (const action of actions) {
            await executeAppAction(action, { ...group, source: 'prompt' });
            executedLabels.push({ action, label: describeAction(action) });
        }

        if (actions.length > 0) {
            recordAiActionGroup({
                prompt,
                actions: executedLabels.map((length) => ({
                    kind: 'appAction' as const,
                    actionType: length.action.type,
                    label: length.label,
                })),
                groupId: group.groupId,
            });
        }
    };

    // ── Execute preset directly ─────────────────────────────────────────
    const executePreset = async (result: PromptFuzzyResult): Promise<void> => {
        const actions = resolvePresetActions({
            presetId: result.preset.id,
            context: presetContext,
        });
        if (actions.length === 0) {
            return;
        }

        if (result.preset.isDestructive) {
            setPreview({
                actions,
                actionLabels: actions.map((action) => describeAction(action)),
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
                    actions.map((alpha) => alpha.type)
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
    const handleSubmit = async (event: FormEvent): Promise<void> => {
        event.preventDefault();
        if (!value.trim() || isProcessing) {
            return;
        }

        setFuzzyResults([]);
        setIsProcessing(true);
        const controller = new AbortController();
        abortRef.current = controller;
        // §188.1 — track the clear-on-finish decision locally instead of
        // reading the `preview` state closure from `finally`. The closure
        // captures the preview value as of when handleSubmit started; any
        // `setPreview(result)` earlier in the same invocation is invisible
        // to it, so the previous code cleared the input even when the user
        // had just been shown a confirmation preview.
        let shouldClearValue = true;
        try {
            const context = getProjectContext();
            const result = await parsePromptToActions(value, context, controller.signal);

            if (controller.signal.aborted) {
                return;
            }

            if (result.requiresConfirmation && result.actions.length > 0) {
                setPreview({
                    ...result,
                    actionLabels: result.actions.map((action) => describeAction(action)),
                });
                setIsProcessing(false);
                shouldClearValue = false;
                return;
            }

            if (result.rejectionReason) {
                notifyAiChange(`Command not executed: ${result.rejectionReason}`, []);
            } else if (result._jsonEditApplied) {
                notifyAiChange(result._jsonEditSummaries?.join('. ') ?? `Executed: ${value}`, []);
            } else if (result.actions.length > 0) {
                await executeWithGroup(result.actions, value);
                notifyAiChange(
                    `Executed: ${value}`,
                    result.actions.map((alpha) => alpha.type)
                );
            } else {
                notifyAiChange('No actions matched. Try rephrasing, or use the AI Chat panel for open-ended help.', []);
            }
        } catch (error) {
            logger.error(new Error('Prompt execution failed', { cause: error }));
        } finally {
            abortRef.current = null;
            setIsProcessing(false);
            if (shouldClearValue) {
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
            preview.actions.map((alpha) => alpha.type)
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
    const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
        if (fuzzyResults.length > 0) {
            if (event.key === 'ArrowDown') {
                event.preventDefault();
                setSelectedIndex((prev) => Math.min(prev + 1, fuzzyResults.length - 1));
            } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setSelectedIndex((prev) => Math.max(prev - 1, -1));
            } else if (event.key === 'Tab' && selectedIndex >= 0) {
                event.preventDefault();
                const selected = fuzzyResults[selectedIndex];
                if (selected) {
                    setValue(selected.preset.label);
                    setFuzzyResults([]);
                }
            } else if (event.key === 'Enter' && selectedIndex >= 0) {
                event.preventDefault();
                const selected = fuzzyResults[selectedIndex];
                if (selected) {
                    void executePreset(selected);
                }
            } else if (event.key === 'Escape') {
                event.preventDefault();
                setFuzzyResults([]);
                setSelectedIndex(-1);
            }
        }
    };

    const handleLoadModel = (modelId?: string): void => {
        if (isLlmAvailable()) {
            void initEngine(modelId);
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
