import { Container } from '#/infra/di/Container';

export abstract class RuntimeLogger {
    abstract debug(...args: unknown[]): void;
    abstract info(...args: unknown[]): void;
    abstract warn(...args: unknown[]): void;
    abstract error(error: Error): void;
}

export function setRuntimeLogger(logger: RuntimeLogger): void {
    Container.set(RuntimeLogger, logger);
}
