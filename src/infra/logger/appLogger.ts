import { createConsoleWriter } from './createConsoleWriter';
import { createLogger } from './createLogger';

export const logger = createLogger([createConsoleWriter()]);
