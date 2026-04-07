import { type LogWriter } from './types';

export const createConsoleWriter = (): LogWriter => {
    const write = (severity: 'debug' | 'info' | 'warn' | 'error', ...args: unknown[]): void => {
        console[severity](`[DEV][${severity.toUpperCase()}]`, ...args);
    };

    return {
        debug: (...args: unknown[]) => write('debug', ...args),
        info: (...args: unknown[]) => write('info', ...args),
        warn: (...args: unknown[]) => write('warn', ...args),
        error: (error: Error) => write('error', error),
    };
};
