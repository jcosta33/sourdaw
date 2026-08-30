import { projectSessionQuiescer } from './projectSessionQuiescer';

import type { ProjectSessionQuiesceOutcome } from './projectSessionQuiesceOutcome';

/** Retire only renderer-owned project runtime before a macOS window closes. */
export async function quiesceProjectSession(
    requestId: number,
    beginDestructiveTeardown: () => Promise<boolean> = async () => true
): Promise<ProjectSessionQuiesceOutcome> {
    return projectSessionQuiescer.request(requestId, beginDestructiveTeardown);
}
