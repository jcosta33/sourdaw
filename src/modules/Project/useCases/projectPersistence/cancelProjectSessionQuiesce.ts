import { projectSessionQuiescer } from './projectSessionQuiescer';

import type { ProjectSessionQuiesceOutcome } from './projectSessionQuiesceOutcome';

/** Restores a started renderer teardown when main revokes its close authority. */
export function cancelProjectSessionQuiesce(requestId: number): Promise<ProjectSessionQuiesceOutcome> {
    return projectSessionQuiescer.cancel(requestId);
}
