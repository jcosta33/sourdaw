import { resolve } from 'node:path';

import { requiredText, writeReceipt } from './journal.ts';
import { preserveNativeTermination, traceCommand } from './nativeTrace.ts';

const [executable, output, ...args] = process.argv.slice(2);
const result = await traceCommand(
    requiredText(executable, 'original executable'),
    args,
    resolve(requiredText(output, 'trace directory'), `browser-${process.pid}`),
    true
);
// Playwright closes through its unchanged debugging pipes, then owns group cleanup.
preserveNativeTermination(result, {
    signal: (signal) => {
        process.kill(process.pid, signal);
    },
    code: (code) => {
        process.exitCode = code;
    },
    unknown: () =>
        writeReceipt(
            resolve(requiredText(output, 'trace directory'), `browser-${process.pid}/termination-unknown.json`),
            { unknown: 'Neither native numeric status nor signal was observed' }
        ),
});
