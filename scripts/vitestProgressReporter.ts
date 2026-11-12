import type { Reporter, TestCase, TestModule } from 'vitest/node';

import { recordVitestModuleFailure, recordVitestProgress } from './vitestProgressDiagnostics.ts';

// Vitest loads custom reporters through their default export.
// oxlint-disable-next-line import/no-default-export
export default class VitestProgressReporter implements Reporter {
    private capturedFailure = false;

    onTestRunStart(): void {
        this.capturedFailure = false;
        recordVitestProgress('runner-start');
    }

    onTestModuleQueued(module: TestModule): void {
        recordVitestProgress('module-queued', module.moduleId);
    }

    onTestModuleCollected(module: TestModule): void {
        recordVitestProgress('module-collected', module.moduleId);
    }

    onTestModuleEnd(module: TestModule): void {
        if (this.capturedFailure || module.state() !== 'failed') {
            return;
        }
        this.capturedFailure = true;
        recordVitestModuleFailure(module.moduleId);
    }

    onTestCaseReady(test: TestCase): void {
        recordVitestProgress('case-ready', test.fullName, undefined, {
            state: test.result().state,
            mode: test.options.mode,
        });
    }
}
