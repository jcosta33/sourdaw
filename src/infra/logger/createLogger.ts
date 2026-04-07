import { type Logger, type LogWriter } from './types';

export const createLogger = (initialWriters?: LogWriter[]): Logger => {
    let writers: LogWriter[] = initialWriters ?? [];

    return {
        debug(...args: unknown[]) {
            for (const writer of writers) {
                writer.debug(...args);
            }
        },

        info(...args: unknown[]) {
            for (const writer of writers) {
                writer.info(...args);
            }
        },

        warn(...args: unknown[]) {
            for (const writer of writers) {
                writer.warn(...args);
            }
        },

        error(error: Error) {
            for (const writer of writers) {
                writer.error(error);
            }
        },

        setWriters(...newWriters: LogWriter[]) {
            writers = newWriters;
        },
    };
};
