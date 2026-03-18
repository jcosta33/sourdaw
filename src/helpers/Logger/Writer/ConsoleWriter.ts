/* (c) Copyright Webdaw Ltd., all rights reserved. */

import { type Writer, type WriteErrorParams } from './Writer';

export class ConsoleWriter implements Writer {
    private readonly write = (severity: 'debug' | 'info' | 'warn' | 'error', ...args: unknown[]): void => {
        console[severity](`[DEV][${severity.toUpperCase()}]`, ...args);
    };

    debug(...args: unknown[]) {
        return this.write('debug', ...args);
    }

    info(...args: unknown[]) {
        return this.write('info', ...args);
    }

    warn(...args: unknown[]) {
        return this.write('warn', ...args);
    }

    error(...args: WriteErrorParams) {
        return this.write('error', ...args);
    }
}
