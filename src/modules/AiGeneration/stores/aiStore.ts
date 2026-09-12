/**
 * Generative AI store.
 * Extracted from generativeAiActions.ts.
 */

import { createStore } from '#/infra/store/createStore';

export type AiTaskType = 'midi-generation' | 'stem-separation' | 'denoise';
export type AiTaskStatus = 'idle' | 'processing' | 'success' | 'error';

/**
 * Success payload of a `midi-generation` task. Generation auto-commits the clip
 * into the arrangement before the task is marked successful, so the payload
 * carries the committed clip's identity — that is the only handle the result
 * card needs to audition or re-select the material. `clipId`/`trackId` are
 * optional because tasks created before the identity existed record only the
 * counts, and their cards must not render actions they cannot honour.
 */
export type AiMidiGenerationTaskData = {
    noteCount: number;
    warning?: string;
    clipId?: string;
    trackId?: string;
};

export type AiTaskResult = {
    id: string;
    type: AiTaskType;
    status: AiTaskStatus;
    prompt?: string;
    timestamp: number;
    error?: string;
    data?: unknown;
    durationMs?: number;
};

export type AiState = {
    tasks: AiTaskResult[];
    isPanelOpen: boolean;
};

const initialState: AiState = {
    tasks: [],
    isPanelOpen: false,
};

export const aiStore = createStore<AiState>({ initialData: initialState });

export function getAiSnapshot() {
    return aiStore.value ?? initialState;
}
