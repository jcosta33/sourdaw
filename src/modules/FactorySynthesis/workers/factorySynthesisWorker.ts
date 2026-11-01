/// <reference lib="webworker" />
/**
 * Factory synthesis Worker. Renders the whole factory library off the main
 * thread so first launch does not spend the synthesis inside one long task.
 *
 * One request per Worker; the client terminates it once answered.
 *
 *   ← { type: 'render' }
 *   → { status: 'complete', samples }   (every channel buffer transferred)
 *   → { status: 'failed' }
 *
 * The handler is bound synchronously at top level: Chromium drops messages
 * posted to a module worker while its top-level evaluation is suspended.
 */

import { renderFactorySynthesisReply } from './factorySynthesisWorkerRuntime';

self.onmessage = (event: MessageEvent<unknown>): void => {
    const { reply, transfer } = renderFactorySynthesisReply(event.data);
    self.postMessage(reply, transfer);
};
