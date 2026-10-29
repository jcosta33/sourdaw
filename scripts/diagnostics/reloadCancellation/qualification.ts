import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { assertRuntimeOrder, assertRuntimePrefix, historicalCases, parseHistoryEvents } from './history.ts';
import { recordOf } from './journal.ts';
import { assertOriginalSource } from './sourceBinding.ts';
import { assertSuccessfulAppCoverage, assertTelemetryHealth, telemetryOutcomes } from './telemetry.ts';

type Check = { observed: true; value: unknown } | { observed: false; reason: string };

function observe(read: () => unknown): Check {
    try {
        return { observed: true, value: read() };
    } catch (error) {
        return { observed: false, reason: error instanceof Error ? error.message : String(error) };
    }
}

function json(path: string): unknown {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return value;
}

function observeTargetSteps(output: string): Check {
    return observe(() => {
        const steps = readFileSync(resolve(output, 'run/target-steps.jsonl'), 'utf8')
            .split('\n')
            .filter(Boolean)
            .map((line) => recordOf(JSON.parse(line) as unknown, 'step event'));
        return {
            originalMoveStepObserved: steps.some(
                (event) => recordOf(event.data, 'step').title === 'Move one MIDI clip through an actual timeline drag'
            ),
            events: steps,
        };
    });
}

function observeTargetAdmission(output: string): Check {
    return observe(() => {
        const admission = recordOf(json(resolve(output, 'run/target-admission.json')), 'target admission');
        if (
            admission.originalHistoryAdmitted !== true ||
            admission.instrumentationReady !== true ||
            admission.receiptMode !== 'transport' ||
            admission.coverage !== 'from-target-beforeEach-only' ||
            admission.workerIndex !== 1 ||
            admission.retry !== 0
        ) {
            throw new Error('Target was not admitted with original history and ready instrumentation');
        }
        return admission;
    });
}

export function qualifyExecution(root: string, output: string, childCode: number): Record<string, Check> {
    const frozen: unknown = JSON.parse(readFileSync(new URL('./original-history.json', import.meta.url), 'utf8'));
    const expected = historicalCases(frozen);
    const runtime = (): ReturnType<typeof parseHistoryEvents> =>
        parseHistoryEvents(readFileSync(resolve(output, 'run/test-history.jsonl'), 'utf8'));
    const events = (path: string): Record<string, unknown>[] =>
        readFileSync(resolve(output, 'run', path), 'utf8')
            .split('\n')
            .filter(Boolean)
            .map((line) => recordOf(JSON.parse(line) as unknown, path));
    return {
        source: observe(() => assertOriginalSource(root)),
        prefix: observe(() => {
            const events = runtime();
            const target = events.findIndex(
                (event) => event.kind === 'test-begin' && event.data.file === 'persistedClipEditAcceptance.spec.ts'
            );
            if (target < 0) {
                throw new Error('Frozen target case never began');
            }
            assertRuntimePrefix(expected, events.slice(0, target + 1));
            return { originalPredecessorsPassed: expected.length - 1 };
        }),
        runtimeOrder: observe(() => {
            assertRuntimeOrder(expected, runtime());
            return { originalCasesCompletedInOrder: expected.length };
        }),
        targetAdmission: observeTargetAdmission(output),
        collector: observe(() => {
            const health = json(resolve(output, 'run/collector-health.json'));
            assertTelemetryHealth(health);
            if (recordOf(health, 'collector health').profile !== 'transport') {
                assertSuccessfulAppCoverage(health, childCode);
            }
            const observations = readFileSync(resolve(output, 'run/browser-observations.jsonl'), 'utf8')
                .split('\n')
                .filter(Boolean)
                .map((line) => recordOf(JSON.parse(line) as unknown, 'browser observation'));
            const installed = observations.findIndex((event) => event.kind === 'App-logpoint-installed');
            const callback = observations.findIndex(
                (event) =>
                    event.kind === 'console' &&
                    typeof recordOf(event.data, 'console data').text === 'string' &&
                    (recordOf(event.data, 'console data').text as string).startsWith(
                        '[reload-cancellation-app-fulfilled] '
                    )
            );
            if (
                recordOf(health, 'collector health').profile !== 'transport' &&
                callback >= 0 &&
                (installed < 0 || installed >= callback)
            ) {
                throw new Error('App fulfillment was observed before its source-bound logpoint installation');
            }
            return {
                health,
                outcomes: telemetryOutcomes(health),
                logpointPrecededObservedCallback: callback < 0 || installed < callback,
            };
        }),
        serverTransport: observe(() => {
            const observations = events('vite-transport.jsonl');
            for (const kind of ['vite-probe-ready', 'http-request-start', 'vite-heartbeat']) {
                if (!observations.some((event) => event.kind === kind)) {
                    throw new Error(`Vite transport probe did not emit ${kind}`);
                }
            }
            return { observedEvents: observations.length };
        }),
        runnerHeartbeat: observe(() => {
            const observations = events('process.jsonl');
            if (
                !observations.some((event) => event.kind === 'runner-heartbeat') ||
                !observations.some((event) => event.kind === 'exit-receipt-written')
            ) {
                throw new Error('Runner heartbeat or close receipt was not emitted');
            }
            return { observedEvents: observations.length };
        }),
        targetResults: observe(() => {
            const lines = readFileSync(resolve(output, 'run/test-errors.jsonl'), 'utf8').split('\n');
            const nonEmpty = lines.filter(Boolean);
            const results = nonEmpty.map((line) => {
                const event: unknown = JSON.parse(line);
                return recordOf(event, 'test result');
            });
            const matches = results.filter(
                (event) => recordOf(event.data, 'result data').file === 'persistedClipEditAcceptance.spec.ts'
            );
            if (matches.length !== 1) {
                throw new Error('Exactly one completed target result was not observed');
            }
            return matches;
        }),
        targetSteps: observeTargetSteps(output),
    };
}
