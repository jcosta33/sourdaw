import { isAbsolute, resolve } from 'node:path';

import { requiredText } from './journal.ts';

export function diagnosticOutput(): string {
    const output = requiredText(process.env.RELOAD_DIAGNOSTIC_OUTPUT, 'diagnostic output');
    if (!isAbsolute(output)) {
        throw new Error('Diagnostic output must be absolute');
    }
    return output;
}

export function phaseOutput(): string {
    const phase = process.env.RELOAD_DIAGNOSTIC_PHASE;
    if (phase !== 'baseline' && phase !== 'candidate' && phase !== 'run') {
        throw new Error('Unknown diagnostic phase');
    }
    return resolve(diagnosticOutput(), phase);
}
