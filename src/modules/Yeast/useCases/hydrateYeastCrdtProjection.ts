import { yeastStore } from '../stores/yeastStore';

import { reconcileYeastGrooveAssignments } from './reconcileYeastGrooveAssignments';

export function hydrateYeastCrdtProjection(): void {
    yeastStore.hydrate();
    reconcileYeastGrooveAssignments();
}
