import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { assertRuntimePrefix, historicalCases, parseHistoryEvents } from './history.ts';
import { writeReceipt } from './journal.ts';
import { attachPassiveObservations } from './pageCollector.ts';
import { phaseOutput } from './paths.ts';

import type { Browser, BrowserContext, Page, TestInfo } from '@playwright/test';

export function originalHistory(): ReturnType<typeof historicalCases> {
    const data: unknown = JSON.parse(readFileSync(new URL('./original-history.json', import.meta.url), 'utf8'));
    return historicalCases(data);
}

export async function admitTargetAndObserve(
    page: Page,
    context: BrowserContext,
    browser: Browser,
    info: TestInfo
): Promise<void> {
    const output = phaseOutput();
    const history = parseHistoryEvents(readFileSync(resolve(output, 'test-history.jsonl'), 'utf8'));
    assertRuntimePrefix(originalHistory(), history);
    if (info.retry !== 0 || info.workerIndex !== 1) {
        throw new Error('Target must retain original worker1 and retry0');
    }
    if (process.env.RELOAD_DIAGNOSTIC_PROFILE !== 'transport') {
        throw new Error('Transport profile is required for this hosted observation');
    }
    await attachPassiveObservations(page, context, browser, output, 'transport');
    writeReceipt(resolve(output, 'target-admission.json'), {
        originalHistoryAdmitted: true,
        instrumentationReady: true,
        receiptMode: 'transport',
        coverage: 'from-target-beforeEach-only',
        AppFulfilledWhenUnobserved: 'unknown',
        workerIndex: info.workerIndex,
        retry: info.retry,
        priorSuccessfulCases: originalHistory().length - 1,
    });
}
