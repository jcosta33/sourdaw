import { type KeyboardEvent, type RefObject, type FormEvent, useState, useRef, useEffect } from 'react';

import { logger } from '#/infra/logger/appLogger';
import { useStore } from '#/infra/store/useStore';
import { llmStatusStore } from '#/modules/AiRuntime/stores';
import {
    submitAdmittedPromptRequest,
    isComplexPrompt,
    searchPresets,
    getAvailablePresets,
    resolvePresetActions,
    onPromptDraft,
    notifyAiChange,
    isLlmAvailable,
    initEngine,
    createVoicePromptDraftAdmission,
} from '#/modules/AiRuntime/useCases';
import {
    clipSelectionStore,
    defaultClipSelectionState,
    defaultTrackState,
    trackStore,
} from '#/modules/Arrangement/stores';

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
    confirm?: (signal?: AbortSignal) => Promise<void>;
    cancel?: () => Promise<void>;
};

function createPromptPreview(input: PromptPreview): PromptPreview {
    const { confirm, cancel, ...visible } = input;
    Object.defineProperties(visible, {
        confirm: { value: confirm },
        cancel: { value: cancel },
    });
    return visible;
}

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

    // ── Canonical draft admission (voice and seeded text stay draft-only) ─
    useEffect(() => {
        const admitVoiceDraft = createVoicePromptDraftAdmission({
            isBusy: () => previewRef.current !== null || operationRef.current !== null,
            appendDraft: (text) => {
                setValue((prev) => (prev ? `${prev} ${text}` : text));
                inputRef.current?.focus();
            },
            rejectBusyDraft: () =>
                notifyAiChange('Voice command not accepted while another AI command is pending or running.', []),
        });
        return onPromptDraft(admitVoiceDraft);
    }, []);

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

    // ── Execute preset directly ─────────────────────────────────────────
    const executePreset = async (result: PromptFuzzyResult): Promise<void> => {
        if (operationRef.current || previewRef.current) {
            return;
        }
        const actions = resolvePresetActions({
            presetId: result.preset.id,
            context: presetContext,
        });
        if (actions.length === 0) {
            return;
        }
        const controller = new AbortController();
        operationRef.current = controller;
        setFuzzyResults([]);
        setIsProcessing(true);
        try {
            const submission = await submitAdmittedPromptRequest({
                prompt: result.preset.label,
                source: 'preset',
                actions,
                requiresConfirmation: result.preset.isDestructive,
                signal: controller.signal,
            });
            if (submission.status === 'awaiting-approval') {
                const { preview: admitted } = submission;
                showPreview(
                    createPromptPreview({
                        actions: [...admitted.actions],
                        actionLabels: [...admitted.actionLabels],
                        rawText: result.preset.label,
                        requiresConfirmation: true,
                        projectRevision: admitted.projectRevision,
                        confirm: admitted.confirm,
                        cancel: admitted.cancel,
                    })
                );
                setValue(result.preset.label);
                return;
            }
        } catch (error) {
            if (!controller.signal.aborted) {
                logger.error(new Error('Preset execution failed', { cause: error }));
            }
        } finally {
            if (operationRef.current === controller) {
                operationRef.current = null;
            }
            setIsProcessing(false);
            if (!previewRef.current) {
                setValue('');
            }
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
        let shouldClearValue = true;
        try {
            const submission = await submitAdmittedPromptRequest({
                prompt: value,
                source: 'prompt-bar',
                signal: controller.signal,
            });
            if (submission.status === 'awaiting-approval') {
                const { preview: admitted } = submission;
                showPreview(
                    createPromptPreview({
                        actions: [...admitted.actions],
                        actionLabels: [...admitted.actionLabels],
                        rawText: value,
                        requiresConfirmation: true,
                        projectRevision: admitted.projectRevision,
                        confirm: admitted.confirm,
                        cancel: admitted.cancel,
                    })
                );
                shouldClearValue = false;
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
        if (!proposal?.confirm || operationRef.current) {
            return;
        }

        const controller = new AbortController();
        operationRef.current = controller;
        clearPreview();
        setIsProcessing(true);
        try {
            await proposal.confirm(controller.signal);
        } catch (error) {
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
        const proposal = previewRef.current;
        if (operationRef.current) {
            operationRef.current.abort();
            return;
        }
        if (proposal?.cancel) {
            void proposal.cancel();
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
            void initEngine(modelId, { webLlmDownloadConsent: true });
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
