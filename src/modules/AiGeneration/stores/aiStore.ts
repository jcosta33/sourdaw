/**
 * Generative AI store.
 * Extracted from generativeAiActions.ts.
 */

import { Store } from '#/helpers/Store/Store';
import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';

export type AiTaskType = 'midi-generation' | 'audio-generation' | 'stem-separation' | 'denoise';
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

const logger = Container.getInstance().get(Logger);

export const aiStore = new Store<AiState>(logger, { initialData: initialState });

export const subscribeAiStore = (callback: () => void) => aiStore.subscribe(callback);
export const getAiSnapshot = () => aiStore.value ?? initialState;
