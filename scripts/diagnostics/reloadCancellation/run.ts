import { mkdirSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { ORIGINAL_NODE, ORIGINAL_PLAYWRIGHT } from './identity.ts';
import { assertCompletedHistory, historicalCases, parseHistoryEvents } from './history.ts';
import { requiredText, writeReceipt } from './journal.ts';
import { materializeHarness } from './materialize.ts';
import { runPhase } from './processPhase.ts';
import { diagnosticArguments, diagnosticEnvironment, qualifyOriginalHistory } from './qualify.ts';
import { assertOriginalSource, gitRead, installedPlaywrightVersion } from './sourceBinding.ts';
import { qualifyExecution } from './qualification.ts';
import { admitHostedAttempt, claimExecution } from './trigger.ts';

export async function runHostedDiagnostic(harness: string, root: string, output: string): Promise<number> {
    mkdirSync(output, { recursive: true });
    const event: unknown = JSON.parse(readFileSync(requiredText(process.env.GITHUB_EVENT_PATH, 'event path'), 'utf8'));
    const head = gitRead(harness, ['rev-parse', 'HEAD']);
    admitHostedAttempt(event, process.env, process.platform, head);
    claimExecution(resolve(output, 'execution-claimed.json'), {
        harnessHead: head,
        runId: process.env.GITHUB_RUN_ID,
        runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    });
    writeReceipt(resolve(output, 'phase-state.json'), { phase: 'preflight', executionAttempted: false });
    if (gitRead(harness, ['status', '--porcelain']) !== '') {
        throw new Error('Diagnostic harness checkout is dirty');
    }
    if (process.version !== ORIGINAL_NODE || installedPlaywrightVersion(root) !== ORIGINAL_PLAYWRIGHT) {
        throw new Error('Original Node and Playwright runtime versions are required');
    }
    const before = assertOriginalSource(root);
    writeReceipt(resolve(output, 'source-before.json'), {
        harnessHead: head,
        target: before,
        runId: process.env.GITHUB_RUN_ID,
        runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    });
    const prepared = materializeHarness(root);
    writeReceipt(resolve(output, 'phase-state.json'), { phase: 'collection', executionAttempted: false });
    await qualifyOriginalHistory(root, output, prepared);
    const env = { ...diagnosticEnvironment(root, output), RELOAD_DIAGNOSTIC_PHASE: 'run' };
    writeReceipt(resolve(output, 'phase-state.json'), { phase: 'execution', executionAttempted: true });
    const code = await runPhase(
        root,
        diagnosticArguments(root, prepared.config, undefined, true),
        env,
        resolve(output, 'run'),
        60 * 60 * 1_000
    );
    const qualification = qualifyExecution(root, output, code);
    const qualified = Object.values(qualification).every((check) => check.observed);
    let passingHistory: { observed: boolean; reason?: string };
    try {
        const saved: unknown = JSON.parse(readFileSync(new URL('./original-history.json', import.meta.url), 'utf8'));
        assertCompletedHistory(
            historicalCases(saved),
            parseHistoryEvents(readFileSync(resolve(output, 'run/test-history.jsonl'), 'utf8'))
        );
        passingHistory = { observed: true };
    } catch (error) {
        passingHistory = { observed: false, reason: error instanceof Error ? error.message : String(error) };
    }
    const result = {
        childCode: code,
        qualified,
        passingHistory,
        qualification,
        receiptMode: 'transport',
        advisoryOnly: true,
        sourceBefore: before,
        originalRequiredRun: { id: 40908733061, attempt: 1, job: 123584034609, remainsUnresolved: true },
        causeClassification:
            'No automatic causal match: inspect actual target steps/errors, network/socket/navigation and process evidence.',
    };
    writeReceipt(resolve(output, 'result.json'), result);
    writeReceipt(resolve(output, 'phase-state.json'), {
        phase: 'complete',
        executionAttempted: true,
        childCode: code,
        qualified,
    });
    return code === 0 && qualified && passingHistory.observed ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const [harness, root, output] = process.argv.slice(2);
    if (!harness || !root || !output || ![harness, root, output].every(isAbsolute)) {
        throw new Error('Usage: node run.ts <absolute-harness-checkout> <absolute-original-source> <absolute-output>');
    }
    try {
        process.exitCode = await runHostedDiagnostic(harness, root, output);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        try {
            claimExecution(resolve(output, 'diagnostic-failure.json'), { message, advisoryOnly: true });
        } catch {
            process.stderr.write(`${message}\n`);
        }
        process.exitCode = 1;
    }
}
