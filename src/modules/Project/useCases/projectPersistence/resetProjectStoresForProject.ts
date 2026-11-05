import { arrangementStore, defaultArrangementStoreState } from '../../stores/arrangementStore';
import { defaultMissingMediaStoreState, missingMediaStore } from '../../stores/missingMediaStore';

/** Project's own part of a project reset: its arrangement snapshots and its missing-media record. */
export function resetProjectStoresForProject(): void {
    arrangementStore.set(structuredClone(defaultArrangementStoreState));
    // The missing-media record describes the project being torn down. Every
    // caller either follows with `verifyAudioBufferReferences` (the load paths,
    // which re-derive it) or is `newProject`, which has no media to miss — so
    // clearing here is what stops a closed project's count from outliving it.
    missingMediaStore.set(structuredClone(defaultMissingMediaStoreState));
}
