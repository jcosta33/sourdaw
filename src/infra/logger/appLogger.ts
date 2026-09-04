import { createConsoleWriter } from './createConsoleWriter';
import { createLogger } from './createLogger';

export const logger = createLogger([createConsoleWriter({ mode: import.meta.env.DEV ? 'development' : 'production' })]);
