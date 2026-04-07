import { createLogger } from './createLogger';
import { createConsoleWriter } from './createConsoleWriter';

export const logger = createLogger([createConsoleWriter()]);
