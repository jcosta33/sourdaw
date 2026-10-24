import { createConsoleWriter } from './createConsoleWriter';
import { createLogger } from './createLogger';
import { resolveConsoleWriterMode } from './resolveConsoleWriterMode';

export const logger = createLogger([createConsoleWriter({ mode: resolveConsoleWriterMode(import.meta.env) })]);
