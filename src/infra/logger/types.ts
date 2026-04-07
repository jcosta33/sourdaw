export type LogWriter = {
    debug: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (error: Error) => void;
};

export type Logger = {
    debug: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (error: Error) => void;
    setWriters: (...writers: LogWriter[]) => void;
};
