import { projectSessionQuiescer } from './projectSessionQuiescer';

/** Restores a started renderer teardown when main revokes its close authority. */
export function cancelProjectSessionQuiesce(requestId: number): Promise<boolean> {
    return projectSessionQuiescer.cancel(requestId);
}
