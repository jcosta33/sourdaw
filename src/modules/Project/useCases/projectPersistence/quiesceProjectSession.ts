import { projectSessionQuiescer } from './projectSessionQuiescer';

/** Retire only renderer-owned project runtime before a macOS window closes. */
export async function quiesceProjectSession(
    requestId: number,
    beginDestructiveTeardown: () => Promise<boolean> = async () => true
): Promise<boolean> {
    return projectSessionQuiescer.request(requestId, beginDestructiveTeardown);
}
