import { type ConsoleWriterMode } from './types';

type BuildEnvironment = {
    DEV: boolean;
    MODE: string;
};

/**
 * Browser shards serve an e2e-mode production build, and the warmup waits for
 * the info-level `[capabilities]` boot marker, so that mode logs like dev.
 */
export const resolveConsoleWriterMode = ({ DEV, MODE }: BuildEnvironment): ConsoleWriterMode =>
    DEV || MODE === 'e2e' ? 'development' : 'production';
