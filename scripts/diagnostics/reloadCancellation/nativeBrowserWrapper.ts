import { resolve } from 'node:path';

import { requiredText } from './journal.ts';
import { traceCommand } from './nativeTrace.ts';

const [executable, output, ...args] = process.argv.slice(2);
const result = await traceCommand(
    requiredText(executable, 'original executable'),
    args,
    resolve(requiredText(output, 'trace directory'), `browser-${process.pid}`),
    true
);
// Playwright closes through its unchanged debugging pipes, then owns group cleanup.
process.exitCode = result.code ?? 1;
