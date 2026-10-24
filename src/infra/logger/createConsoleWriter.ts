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

type DataProperty = { kind: 'value'; value: unknown } | { kind: 'missing' | 'unreadable' };

const readDataProperty = (object: object, key: PropertyKey, inherited = false, skipAccessors = false): DataProperty => {
    let current: object | null = object;
    for (let depth = 0; current !== null && depth <= MAX_NESTED_DEPTH; depth += 1) {
        try {
            const descriptor = Object.getOwnPropertyDescriptor(current, key);
            if (descriptor !== undefined) {
                if ('value' in descriptor) {
                    return { kind: 'value', value: descriptor.value };
                }
                if (!skipAccessors) {
                    return { kind: 'unreadable' };
                }
            }
            if (!inherited) {
                return { kind: 'missing' };
            }
            const prototype: unknown = Object.getPrototypeOf(current);
            current = prototype !== null && typeof prototype === 'object' ? prototype : null;
        } catch {
            return { kind: 'unreadable' };
        }
    }
    return { kind: 'missing' };
};

const errorLabel = (error: Error): string => {
    const name = readDataProperty(error, 'name', true, true);
    const message = readDataProperty(error, 'message', true);
    const nameText = boundedText(name.kind === 'value' ? name.value : undefined, 'Error');
    const messageText = boundedText(message.kind === 'value' ? message.value : undefined, '[unreadable message]');
    return `${nameText}: ${messageText}`;
};

const appendAggregateErrors = (
    error: Error,
    path: string,
    depth: number,
    parts: string[],
    visitChild: (child: unknown, path: string, depth: number) => void
): boolean => {
    const errors = readDataProperty(error, 'errors');
    if (errors.kind === 'missing') {
        return false;
    }
    try {
        if (errors.kind !== 'value' || !Array.isArray(errors.value)) {
            parts.push(`${path}.errors: [unreadable errors]`);
            return true;
        }
        const children = errors.value;
        const length = readDataProperty(children, 'length');
        if (
            length.kind !== 'value' ||
            typeof length.value !== 'number' ||
            !Number.isSafeInteger(length.value) ||
            length.value < 0
        ) {
            parts.push(`${path}.errors: [unreadable errors]`);
            return true;
        }
        if (length.value === 0) {
            return false;
        }
        const count = Math.min(length.value, MAX_AGGREGATE_CHILDREN);
        for (let index = 0; index < count; index += 1) {
            const childPath = `${path}.errors[${index}]`;
            const child = readDataProperty(children, index.toString());
            if (child.kind === 'value') {
                visitChild(child.value, childPath, depth + 1);
            } else {
                parts.push(`${childPath}: [unreadable error]`);
            }
        }
        if (length.value > count) {
            parts.push(`${path}.errors: [${length.value - count} more errors]`);
        }
        return true;
    } catch {
        parts.push(`${path}.errors: [unreadable errors]`);
        return true;
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

        const cause = readDataProperty(error, 'cause');
        if (cause.kind === 'unreadable') {
            nested = true;
            parts.push(`${path}.cause: [unreadable cause]`);
        } else if (cause.kind === 'value' && cause.value !== undefined) {
            nested = true;
            if (isNativeError(cause.value)) {
                visit(cause.value, `${path}.cause`, depth + 1);
            } else {
                parts.push(`${path}.cause: [non-Error cause]`);
            }
        }

        if (appendAggregateErrors(error, path, depth, parts, visitChild)) {
            nested = true;
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
    let reportingDevelopmentError = false;
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
            if (mode !== 'development') {
                write('error', error);
                return;
            }
            if (reportingDevelopmentError) {
                return;
            }
            // A proxy trap during diagnostic inspection may itself report this error.
            reportingDevelopmentError = true;
            try {
                const nestedErrors = formatNestedErrors(error);
                if (nestedErrors === undefined) {
                    write('error', error);
                    return;
                }
                write('error', error, nestedErrors);
            } finally {
                reportingDevelopmentError = false;
            }
        },
    };
};
