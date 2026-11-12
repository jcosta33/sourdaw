import type { Reporter, TestCase, TestModule } from 'vitest/node';

import { recordVitestProgress } from './vitestProgressDiagnostics.ts';

// Vitest loads custom reporters through their default export.
// oxlint-disable-next-line import/no-default-export
export default class VitestProgressReporter implements Reporter {
    onTestRunStart(): void {
        recordVitestProgress('runner-start');
    }

    onTestModuleQueued(module: TestModule): void {
        recordVitestProgress('module-queued', module.moduleId);
    }

    onTestModuleCollected(module: TestModule): void {
        recordVitestProgress('module-collected', module.moduleId);
    }

    onTestCaseReady(test: TestCase): void {
        recordVitestProgress('test-start', test.fullName);
    }
}
