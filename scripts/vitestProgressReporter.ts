import { captureProcessGroupOfPid } from './processSnapshot.ts';
import { recordVitestProgress, VITEST_PROGRESS_ENV } from './vitestProgressDiagnostics.ts';

import type { Reporter, TestCase, TestModule } from 'vitest/node';

/** The first failed module is observed before Vitest tears the runner down. */
function recordVitestModuleFailure(moduleId: string): void {
    if (!process.env[VITEST_PROGRESS_ENV]) {
        return;
    }
    try {
        const monotonicNs = process.hrtime.bigint().toString();
        const processGroup = captureProcessGroupOfPid(process.pid);
        recordVitestProgress('module-failure', moduleId, { monotonicNs, processGroup });
    } catch {
        // An unavailable diagnostic must not alter the test result.
    }
}

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
