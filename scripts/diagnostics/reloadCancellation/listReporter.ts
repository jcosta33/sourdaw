import { basename, resolve } from 'node:path';

import { ORIGINAL_SPEC, WRAPPER } from './identity.ts';
import { createJournal, writeReceipt } from './journal.ts';
import { phaseOutput } from './paths.ts';

import type { FullConfig } from '@playwright/test';
import type { FullResult, Reporter, Suite, TestCase, TestError, TestResult, TestStep } from '@playwright/test/reporter';

export function reportedFile(path: string): string {
    const file = basename(path);
    return file === basename(WRAPPER) ? basename(ORIGINAL_SPEC) : file;
}

function identity(test: TestCase): { project: string; file: string; title: string; testId: string } {
    const project = test.parent.project();
    if (!project) {
        throw new Error('Collected test has no project');
    }
    return { project: project.name, file: reportedFile(test.location.file), title: test.title, testId: test.id };
}

// oxlint-disable-next-line import/no-default-export -- Playwright instantiates reporters through this export.
export default class ReloadDiagnosticReporter implements Reporter {
    onBegin(config: FullConfig, suite: Suite): void {
        writeReceipt(resolve(phaseOutput(), 'list.json'), {
            workers: config.workers,
            projects: config.projects.map((project) => ({
                name: project.name,
                retries: project.retries,
                timeout: project.timeout,
                testDir: project.testDir,
                testMatch: project.testMatch,
                testIgnore: project.testIgnore,
                use: project.use,
            })),
            tests: suite.allTests().map((test) => ({
                ...identity(test),
                timeout: test.timeout,
                retries: test.retries,
                expectedStatus: test.expectedStatus,
            })),
            sourceFiles: suite.allTests().map((test) => test.location.file),
            ownerFiles: suite.allTests().map((test) => test.titlePath()[2]),
        });
    }

    onTestBegin(test: TestCase, result: TestResult): void {
        createJournal(resolve(phaseOutput(), 'test-history.jsonl'))('test-begin', {
            ...identity(test),
            workerIndex: result.workerIndex,
            retry: result.retry,
        });
    }

    onTestEnd(test: TestCase, result: TestResult): void {
        createJournal(resolve(phaseOutput(), 'test-history.jsonl'))('test-end', {
            ...identity(test),
            workerIndex: result.workerIndex,
            retry: result.retry,
            status: result.status,
            resultStartTimeMs: result.startTime.getTime(),
            resultDurationMs: result.duration,
            expectedResultEndMs: result.startTime.getTime() + result.duration,
        });
        createJournal(resolve(phaseOutput(), 'test-errors.jsonl'))('test-result', {
            ...identity(test),
            status: result.status,
            duration: result.duration,
            errors: result.errors,
        });
    }

    onError(error: TestError): void {
        createJournal(resolve(phaseOutput(), 'test-errors.jsonl'))('runner-error', error);
    }

    onStepBegin(test: TestCase, _result: TestResult, step: TestStep): void {
        if (identity(test).file === 'persistedClipEditAcceptance.spec.ts') {
            createJournal(resolve(phaseOutput(), 'target-steps.jsonl'))('step-begin', {
                title: step.title,
                category: step.category,
                location: step.location,
            });
        }
    }

    onStepEnd(test: TestCase, _result: TestResult, step: TestStep): void {
        if (identity(test).file === 'persistedClipEditAcceptance.spec.ts') {
            createJournal(resolve(phaseOutput(), 'target-steps.jsonl'))('step-end', {
                title: step.title,
                category: step.category,
                location: step.location,
                error: step.error,
                duration: step.duration,
            });
        }
    }

    onEnd(result: FullResult): void {
        writeReceipt(resolve(phaseOutput(), 'playwright-result.json'), result);
    }
}
