import { createHandler } from '#/utils/createHandler';
import { type MarkerSectionSnapshot } from '#/utils/handlerContract';

import { markerStore } from '../../stores/markerStore';
import { scratchPadStore } from '../../stores/scratchPadStore';
import { commitScratchPadToArrangement } from '../../useCases/scratchPad/captureCommit/commitScratchPadToArrangement';

function hasNothingToCommit(): boolean {
    const padState = scratchPadStore.value;
    const markerState = markerStore.value;
    return !padState || !markerState || padState.sections.length === 0;
}

// `commitScratchPadToArrangement` mints fresh marker section ids (`crypto.randomUUID()`),
// so the post-commit marker collection is only knowable after it runs. `describe()` runs
// before `execute()` and seeds this empty; `execute()` appends the minted sections in
// place once the write lands, and both the inverse and redo actions already hold a
// reference to this exact array — the same describe-then-finalize pattern `handleFreezeTrack`
// uses for its own async-settled state. Keyed by action so concurrent commits cannot cross.
const pendingCommittedMarkerSections = new WeakMap<object, MarkerSectionSnapshot[]>();

export const handleCommitScratchPad = createHandler<'commitScratchPad'>({
    execute: (action) => {
        if (hasNothingToCommit()) {
            return { status: 'no-write' };
        }
        commitScratchPadToArrangement();
        const pending = pendingCommittedMarkerSections.get(action);
        const settledMarkerState = markerStore.value;
        if (pending && settledMarkerState) {
            pending.push(...structuredClone(settledMarkerState.sections));
        }
        return { status: 'written' };
    },
    describe: (action) => {
        const padState = scratchPadStore.value;
        const markerState = markerStore.value;
        if (!padState || !markerState || padState.sections.length === 0) {
            return { label: 'Apply Scratch Pad to Arrangement', inverseAction: null };
        }
        const capturedPadSections = structuredClone(padState.sections);
        const previousMarkerSections = structuredClone(markerState.sections);
        // Seeded empty; `execute()` fills it in with the sections the commit actually mints.
        const settledMarkerSections: MarkerSectionSnapshot[] = [];
        pendingCommittedMarkerSections.set(action, settledMarkerSections);
        return {
            label: 'Apply Scratch Pad to Arrangement',
            inverseAction: {
                type: 'restoreScratchPadState',
                payload: {
                    // This command never touches the pad, so both sides of its guard carry
                    // the same live snapshot — same convention as `handleClearScratchPad`
                    // guarding the markers it does not touch.
                    expectedSections: capturedPadSections,
                    replacementSections: capturedPadSections,
                    expectedMarkerSections: settledMarkerSections,
                    replacementMarkerSections: previousMarkerSections,
                },
            },
            redoAction: {
                type: 'restoreScratchPadState',
                payload: {
                    expectedSections: capturedPadSections,
                    replacementSections: capturedPadSections,
                    expectedMarkerSections: previousMarkerSections,
                    replacementMarkerSections: settledMarkerSections,
                },
            },
        };
    },
    isNoop: hasNothingToCommit,
    undoable: true,
});
