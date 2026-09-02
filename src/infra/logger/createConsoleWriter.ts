import { type ConsoleWriterMode, type LogSeverity, type LogWriter } from './types';

const SEVERITY_LEVELS: LogSeverity[] = ['debug', 'info', 'warn', 'error'];

const MIN_SEVERITY_BY_MODE: Record<ConsoleWriterMode, LogSeverity> = {
    development: 'debug',
    production: 'warn', // Console noise hides real warnings and leaks internals to users.
};

const PREFIX_BY_MODE: Record<ConsoleWriterMode, string> = {
    development: '[DEV]',
    production: '[Sourdaw]',
};

const shouldWrite = (severity: LogSeverity, mode: ConsoleWriterMode): boolean => {
    const minSeverityIndex = SEVERITY_LEVELS.indexOf(MIN_SEVERITY_BY_MODE[mode]);
    const currentSeverityIndex = SEVERITY_LEVELS.indexOf(severity);
    return currentSeverityIndex >= minSeverityIndex;
};

const formatPrefix = (severity: LogSeverity, mode: ConsoleWriterMode): string => {
    if (mode === 'development') {
        return `${PREFIX_BY_MODE[mode]}[${severity.toUpperCase()}]`;
    }
    return `${PREFIX_BY_MODE[mode]}[${severity.toUpperCase()}]`;
};

export const createConsoleWriter = ({ mode }: { mode: ConsoleWriterMode }): LogWriter => {
    const write = (severity: LogSeverity, ...args: unknown[]): void => {
        if (!shouldWrite(severity, mode)) {
            return;
        }
        const prefix = formatPrefix(severity, mode);
        console[severity](prefix, ...args);
    };

    return {
        debug: (...args: unknown[]) => write('debug', ...args),
        info: (...args: unknown[]) => write('info', ...args),
        warn: (...args: unknown[]) => write('warn', ...args),
        error: (error: Error) => write('error', error),
    };
};
