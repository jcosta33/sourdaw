import { type ConsoleWriterMode, type LogSeverity, type LogWriter } from './types';

const SEVERITY_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

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

const formatPrefix = (severity: LogSeverity, mode: ConsoleWriterMode): string =>
    `${PREFIX_BY_MODE[mode]}[${severity.toUpperCase()}]`;

const MAX_NESTED_DEPTH = 4;
const MAX_AGGREGATE_CHILDREN = 3;
const MAX_NESTED_ERRORS = 24;
const MAX_ERROR_TEXT_LENGTH = 200;
const MAX_DIAGNOSTIC_LENGTH = 2048;

const isNativeError = (value: unknown): value is Error => {
    const errorIsError: unknown = Reflect.get(Error, 'isError');
    return typeof errorIsError === 'function' && Reflect.apply(errorIsError, Error, [value]) === true;
};

const boundedText = (value: unknown, fallback: string): string => {
    if (typeof value !== 'string') {
        return fallback;
    }
    return value.length > MAX_ERROR_TEXT_LENGTH ? `${value.slice(0, MAX_ERROR_TEXT_LENGTH)}[truncated]` : value;
};

const errorLabel = (error: Error): string => {
    try {
        return `${boundedText(error.name, 'Error')}: ${boundedText(error.message, '[unreadable message]')}`;
    } catch {
        return 'Error: [unreadable message]';
    }
};

const formatNestedErrors = (root: Error): string | undefined => {
    const parts: string[] = [];
    const ancestors = new Set<Error>();
    let nested = false;
    let visited = 0;

    function visitChild(child: unknown, path: string, depth: number): void {
        if (isNativeError(child)) {
            visit(child, path, depth);
            return;
        }
        parts.push(`${path}: [non-Error child]`);
    }

    const visit = (error: Error, path: string, depth: number): void => {
        if (ancestors.has(error)) {
            parts.push(`${path}: [cycle]`);
            return;
        }
        if (depth > MAX_NESTED_DEPTH) {
            parts.push(`${path}: [depth limit]`);
            return;
        }
        if (visited >= MAX_NESTED_ERRORS) {
            parts.push(`${path}: [error limit]`);
            return;
        }
        if (!isNativeError(error)) {
            parts.push(`${path}: [non-Error cause]`);
            return;
        }

        visited += 1;
        ancestors.add(error);
        parts.push(`${path}: ${errorLabel(error)}`);

        try {
            const cause = error.cause;
            if (cause !== undefined) {
                nested = true;
                if (isNativeError(cause)) {
                    visit(cause, `${path}.cause`, depth + 1);
                } else {
                    parts.push(`${path}.cause: [non-Error cause]`);
                }
            }
        } catch {
            nested = true;
            parts.push(`${path}.cause: [unreadable cause]`);
        }

        const errorsDescriptor = Object.getOwnPropertyDescriptor(error, 'errors');
        if (errorsDescriptor !== undefined) {
            try {
                if (!('value' in errorsDescriptor)) {
                    nested = true;
                    parts.push(`${path}.errors: [unreadable errors]`);
                    ancestors.delete(error);
                    return;
                }
                const children: unknown = errorsDescriptor.value;
                if (!Array.isArray(children)) {
                    nested = true;
                    parts.push(`${path}.errors: [unreadable errors]`);
                } else if (children.length > 0) {
                    nested = true;
                    const count = Math.min(children.length, MAX_AGGREGATE_CHILDREN);
                    for (let index = 0; index < count; index += 1) {
                        const child: unknown = children[index];
                        const childPath = `${path}.errors[${index}]`;
                        visitChild(child, childPath, depth + 1);
                    }
                    if (children.length > count) {
                        parts.push(`${path}.errors: [${children.length - count} more errors]`);
                    }
                }
            } catch {
                nested = true;
                parts.push(`${path}.errors: [unreadable errors]`);
            }
        }

        ancestors.delete(error);
    };

    try {
        if (!isNativeError(root)) {
            return undefined;
        }
        visit(root, 'error', 0);
    } catch {
        return 'Nested errors: [unavailable]';
    }

    if (!nested) {
        return undefined;
    }
    const diagnostic = `Nested errors: ${parts.join('; ')}`;
    return diagnostic.length > MAX_DIAGNOSTIC_LENGTH
        ? `${diagnostic.slice(0, MAX_DIAGNOSTIC_LENGTH - '[truncated]'.length)}[truncated]`
        : diagnostic;
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
        error: (error: Error) => {
            const nestedErrors = mode === 'development' ? formatNestedErrors(error) : undefined;
            if (nestedErrors === undefined) {
                write('error', error);
                return;
            }
            write('error', error, nestedErrors);
        },
    };
};
