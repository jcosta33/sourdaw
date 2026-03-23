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

export type GenerativeAiState = {
    tasks: AiTaskResult[];
    isPanelOpen: boolean;
};

const initialState: GenerativeAiState = {
    tasks: [],
    isPanelOpen: false,
};

const logger = Container.getInstance().get(Logger);

export const generativeAiStore = new Store<GenerativeAiState>(logger, { initialData: initialState });

export const subscribeGenerativeAi = (callback: () => void) => generativeAiStore.subscribe(callback);
export const getGenerativeAiSnapshot = () => generativeAiStore.value ?? initialState;
