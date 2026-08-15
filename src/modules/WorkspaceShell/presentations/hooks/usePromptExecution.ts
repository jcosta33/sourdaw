import { type KeyboardEvent, type RefObject, type FormEvent, useState, useRef, useEffect } from 'react';

import { logger } from '#/infra/logger/appLogger';
import { useStore } from '#/infra/store/useStore';
import { llmStatusStore } from '#/modules/AiRuntime/stores';
import {
    executePlannedActions,
    compilePlannedActionCommandBatch,
    describePlannedAction,
    getProjectContext,
    planPromptActions,
    isComplexPrompt,
    searchPresets,
    getAvailablePresets,
    resolvePresetActions,
    onPromptInjection,
    notifyAiChange,
    isLlmAvailable,
    initEngine,
} from '#/modules/AiRuntime/useCases';
import {
    clipSelectionStore,
    defaultClipSelectionState,
    defaultTrackState,
    trackStore,
} from '#/modules/Arrangement/stores';
import { generateGroupId, isExecutableAppActionType, requiresAppActionConfirmation } from '#/modules/Command/useCases';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';

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
    projectRevision: string;
    executionMode?: 'atomic';
};

type ExecutePromptActionGroupInput = {
    actions: PromptAction[];
    prompt: string;
    projectRevision: string;
    executionMode?: 'atomic';
    signal?: AbortSignal;
    successVerb?: 'Executed' | 'Confirmed';
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
    const operationRef = useRef<AbortController | null>(null);
    const pendingSubmitRef = useRef(false);
    const previewRef = useRef<PromptPreview | null>(null);

    const showPreview = (proposal: PromptPreview): void => {
        previewRef.current = proposal;
        setPreview(proposal);
    };

    const clearPreview = (): void => {
        previewRef.current = null;
        setPreview(null);
    };

    const llmStatus = useStore(llmStatusStore, defaultLlmStatus);
    const trackState = useStore(trackStore, defaultTrackState);
    const clipSelection = useStore(clipSelectionStore, defaultClipSelectionState);

    // ── Derive selection tags ───────────────────────────────────────────
    const selectionTags: SelectionTag[] = [];
    const selectedTrackId = trackState?.selectedTrackId;
    const selectedTrack = trackState?.tracks.find((track) => track.id === selectedTrackId);
    const selectedClipId = clipSelection.selectedClipId;
    const selectedClipIds = clipSelection.selectedClipIds;

    if (selectedTrackId) {
        if (selectedTrack && !dismissedTags.has(`track:${selectedTrackId}`)) {
            selectionTags.push({
                id: `track:${selectedTrackId}`,
                label: selectedTrack.name,
                kind: 'track',
                icon: 'track',
            });
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
        selectedTrackKind: selectedTrack?.kind,
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
            if (previewRef.current || operationRef.current) {
                notifyAiChange('Voice command not accepted while another AI command is pending or running.', []);
                return;
            }
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
    const executeWithGroup = async (input: ExecutePromptActionGroupInput): Promise<void> => {
        const context = getProjectContext();
        const group = generateGroupId(input.prompt);
        const usesVersionedBatch = input.actions.every((action) => isExecutableAppActionType(action.type));
        if (!usesVersionedBatch) {
            notifyAiChange(
                'Command not executed: one or more actions are not available through the approved command boundary.',
                []
            );
            return;
        }
        const commandBatch = compilePlannedActionCommandBatch({
            actions: input.actions,
            actionLabels: input.actions.map((action) => describePlannedAction({ action, context })),
            autoCommit: true,
            autoCommitApproval: () =>
                captureProjectRevision() === input.projectRevision
                    ? { status: 'valid' }
                    : { status: 'invalid', reason: 'The command-palette source revision is stale.' },
            context,
            group,
            intent: input.prompt,
            projectRevision: input.projectRevision,
            runId: `prompt-execution-${crypto.randomUUID()}`,
        }).commandBatch;
        const execution = await executePlannedActions({ ...input, group, commandBatch });
        if (execution.status === 'committed' || execution.status === 'executed') {
            return;
        }
        if (execution.status === 'invalidated' || execution.status === 'failed') {
            notifyAiChange(`Command not executed: ${execution.reason}`, []);
            return;
        }
        if (execution.status === 'ambiguous') {
            notifyAiChange(
                `Command outcome is uncertain: ${execution.reason}. Inspect the project before retrying.`,
                []
            );
            return;
        }
        if (execution.status === 'cancelled') {
            notifyAiChange('Command cancelled before it committed. No project changes were applied.', []);
            return;
        }
        notifyAiChange('No project changes were needed.', []);
    };

    // ── Execute preset directly ─────────────────────────────────────────
    const executePreset = async (result: PromptFuzzyResult): Promise<void> => {
        if (operationRef.current || previewRef.current) {
            return;
        }
        const actions = resolvePresetActions({
            presetId: result.preset.id,
            context: presetContext,
        });
        const projectRevision = captureProjectRevision();
        if (actions.length === 0) {
            return;
        }

        if (result.preset.isDestructive || requiresAppActionConfirmation(actions)) {
            const context = getProjectContext();
            showPreview({
                actions,
                actionLabels: actions.map((action) => describePlannedAction({ action, context })),
                rawText: result.preset.label,
                requiresConfirmation: true,
                projectRevision,
            });
            setValue(result.preset.label);
            setFuzzyResults([]);
            return;
        }

        const controller = new AbortController();
        operationRef.current = controller;
        setFuzzyResults([]);
        setIsProcessing(true);
        try {
            await executeWithGroup({
                actions,
                prompt: result.preset.label,
                projectRevision,
                signal: controller.signal,
            });
        } catch (error) {
            if (!controller.signal.aborted) {
                logger.error(new Error('Preset execution failed', { cause: error }));
            }
        } finally {
            if (operationRef.current === controller) {
                operationRef.current = null;
            }
            setIsProcessing(false);
            setValue('');
        }
    };

    // ── Full prompt submission (for complex / LLM) ──────────────────────
    const handleSubmit = async (event: FormEvent): Promise<void> => {
        event.preventDefault();
        if (!value.trim() || operationRef.current || previewRef.current) {
            return;
        }

        const controller = new AbortController();
        operationRef.current = controller;
        setFuzzyResults([]);
        setIsProcessing(true);
        // §188.1 — track the clear-on-finish decision locally instead of
        // reading the `preview` state closure from `finally`. The closure
        // captures the preview value as of when handleSubmit started; any
        // `showPreview(result)` earlier in the same invocation is invisible
        // to it, so the previous code cleared the input even when the user
        // had just been shown a confirmation preview.
        let shouldClearValue = true;
        try {
            const { context, result, projectRevision } = await planPromptActions({
                prompt: value,
                signal: controller.signal,
            });

            if (controller.signal.aborted) {
                return;
            }

            if (result.requiresConfirmation && result.actions.length > 0) {
                showPreview({
                    ...result,
                    actionLabels: result.actions.map((action) => describePlannedAction({ action, context })),
                    projectRevision,
                });
                setIsProcessing(false);
                shouldClearValue = false;
                return;
            }

            if (result.rejectionReason) {
                notifyAiChange(`Command not executed: ${result.rejectionReason}`, []);
            } else if (result.actions.length > 0) {
                await executeWithGroup({
                    actions: result.actions,
                    prompt: value,
                    projectRevision,
                    executionMode: result.executionMode,
                    signal: controller.signal,
                });
            } else {
                notifyAiChange('No actions matched. Try rephrasing, or use the AI Chat panel for open-ended help.', []);
            }
        } catch (error) {
            if (controller.signal.aborted) {
                return;
            }
            if (error instanceof Error && error.name === 'AiProposalInvalidatedError') {
                notifyAiChange(`Command not executed: ${error.message}`, []);
            } else {
                logger.error(new Error('Prompt execution failed', { cause: error }));
            }
        } finally {
            if (operationRef.current === controller) {
                operationRef.current = null;
            }
            setIsProcessing(false);
            if (shouldClearValue) {
                setValue('');
            }
        }
    };

    const confirmPreview = async (): Promise<void> => {
        const proposal = previewRef.current;
        if (!proposal || operationRef.current) {
            return;
        }

        const controller = new AbortController();
        operationRef.current = controller;
        clearPreview();
        setIsProcessing(true);
        try {
            await executeWithGroup({
                actions: proposal.actions,
                prompt: proposal.rawText,
                projectRevision: proposal.projectRevision,
                executionMode: proposal.executionMode,
                signal: controller.signal,
                successVerb: 'Confirmed',
            });
        } catch (error) {
            // `PromptBar` wires this straight to onClick, so a throw here (e.g. from
            // waitForAutomergeSnapshotTransaction) becomes an unhandled rejection with no
            // log and no user notice — on the path a *destructive* confirmed preset takes.
            if (!controller.signal.aborted) {
                logger.error(new Error('Confirmed preview execution failed', { cause: error }));
                notifyAiChange('Command not executed: the confirmed changes could not be applied.', []);
            }
        } finally {
            if (operationRef.current === controller) {
                operationRef.current = null;
            }
            setIsProcessing(false);
            setValue('');
        }
    };

    const cancelPreview = (): void => {
        if (operationRef.current) {
            operationRef.current.abort();
            return;
        }
        clearPreview();
    };

    const cancelProcessing = (): void => {
        operationRef.current?.abort();
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
