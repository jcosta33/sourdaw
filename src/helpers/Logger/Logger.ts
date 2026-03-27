/* (c) Copyright Sourdaw Ltd., all rights reserved. */

import { type WriteErrorParams, type Writer } from './Writer/Writer';

export class Logger {
    #writers: Writer[] = [];

    constructor(writers?: Writer[]) {
        this.#writers = writers ?? [];
    }

    public setWriters(...writers: Writer[]): void {
        this.#writers = writers;
    }

    public debug(...args: unknown[]) {
        for (const writer of this.#writers) {
            writer.debug(...args);
        }
    }

    public info(...args: unknown[]) {
        for (const writer of this.#writers) {
            writer.info(...args);
        }
    }

    public warn(...args: unknown[]) {
        for (const writer of this.#writers) {
            writer.warn(...args);
        }
    }

    public error(...args: WriteErrorParams) {
        for (const writer of this.#writers) {
            writer.error(...args);
        }
    }
}
