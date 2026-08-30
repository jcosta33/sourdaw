import { projectSessionQuiesceCancellation } from './projectSessionQuiesceCancellation';

/** Restores a started renderer teardown when main revokes its close authority. */
export function cancelProjectSessionQuiesce(): void {
    projectSessionQuiesceCancellation.cancel();
}
