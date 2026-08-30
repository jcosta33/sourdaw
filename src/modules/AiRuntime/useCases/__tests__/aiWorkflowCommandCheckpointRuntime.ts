import { vi } from 'vitest';

import {
    commandProjectRevisionPort,
    configureCommandBatchIdempotency,
    resetCommandBatchIdempotency,
} from '#/modules/Command/useCases';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';

const COMMAND_BATCH_IDEMPOTENCY_STORAGE_KEY = 'sourdaw:command-batch-idempotency:v1';

function installNavigatorLocksStub(): void {
    if (typeof navigator.locks?.request === 'function') {
        return;
    }
    vi.stubGlobal('navigator', {
        ...navigator,
        locks: {
            request: (_name: string, _options: LockOptions, task: () => unknown) => Promise.resolve(task()),
        },
    });
}

export function configureAiWorkflowCommandCheckpointRuntime(): void {
    // Production shape, from `src/app/bootstrap.ts`. Only a batch executed
    // under the durable idempotency ledger reaches a project checkpoint, and
    // only a configured revision provider can expose that checkpoint's exact
    // revision — which the confirmation path requires before it may report a
    // clean commit. jsdom has no navigator.locks; the durable project
    // checkpoint is written under that lock.
    installNavigatorLocksStub();
    configureCommandBatchIdempotency({ canExecute: () => true });
    commandProjectRevisionPort.setProvider(captureProjectRevision);
}

export function resetAiWorkflowCommandCheckpointRuntime(): void {
    commandProjectRevisionPort.setProvider(null);
    resetCommandBatchIdempotency();
    localStorage.removeItem(COMMAND_BATCH_IDEMPOTENCY_STORAGE_KEY);
}
