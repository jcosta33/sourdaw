/**
 * Generative AI store.
 * Extracted from generativeAiActions.ts.
 */

import { createStore } from '#/infra/store/createStore';

export type AiTaskType = 'midi-generation' | 'stem-separation' | 'denoise';
export type AiTaskStatus = 'idle' | 'processing' | 'success' | 'error';

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
