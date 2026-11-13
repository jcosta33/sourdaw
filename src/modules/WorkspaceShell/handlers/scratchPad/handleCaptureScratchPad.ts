import { markerStore, scratchPadStore } from '#/modules/Arrangement/stores';
import { captureArrangementToScratchPad } from '#/modules/Arrangement/useCases';
import { createHandler } from '#/utils/createHandler';
import { type ScratchPadSectionSnapshot } from '#/utils/handlerContract';

import { workspaceStore } from '../../stores/workspaceStore';

function hasNothingToCapture(): boolean {
    const markerState = markerStore.value;
    return !markerState || markerState.sections.length === 0;
}

// `captureArrangementToScratchPad` mints fresh pad section ids (`crypto.randomUUID()`),
// so the post-capture pad is only knowable after it runs. `describe()` runs before
// `execute()` and seeds this empty; `execute()` appends the minted sections in place
// once the write lands, and both the inverse and redo actions already hold a reference
// to this exact array — the same describe-then-finalize pattern `handleCommitScratchPad`
// uses for the marker sections it mints. Keyed by action so concurrent captures cannot cross.
const pendingCapturedPadSections = new WeakMap<object, ScratchPadSectionSnapshot[]>();

export const handleCaptureScratchPad = createHandler<'captureScratchPad'>({
    execute: (action) => {
        if (hasNothingToCapture()) {
            return { status: 'no-write' };
        }
        captureArrangementToScratchPad();
        const pending = pendingCapturedPadSections.get(action);
        const settledPadState = scratchPadStore.value;
        if (pending && settledPadState) {
            pending.push(...structuredClone(settledPadState.sections));
        }
        // Also open the scratch pad if it's closed
        const state = workspaceStore.value;
        if (state && !state.scratchPadOpen) {
            workspaceStore.set({ ...state, scratchPadOpen: true, scratchPadCollapsed: false });
        }
        return { status: 'written' };
    },
    describe: (action) => {
        const label = 'Capture Arrangement to Scratch Pad';
        const markerState = markerStore.value;
        if (!markerState || markerState.sections.length === 0) {
            return { label, inverseAction: null };
        }
        const previousPadSections = structuredClone(scratchPadStore.value?.sections ?? []);
        const liveMarkerSections = structuredClone(markerState.sections);
        // Seeded empty; `execute()` fills it in with the sections the capture actually mints.
        const settledPadSections: ScratchPadSectionSnapshot[] = [];
        pendingCapturedPadSections.set(action, settledPadSections);
        return {
            label,
            inverseAction: {
                type: 'restoreScratchPadState',
                payload: {
                    expectedSections: settledPadSections,
                    replacementSections: previousPadSections,
                    // Capture never touches the markers, so both sides of the guard carry
                    // the same live snapshot — same convention as `handleClearScratchPad`.
                    expectedMarkerSections: liveMarkerSections,
                    replacementMarkerSections: liveMarkerSections,
                },
            },
            redoAction: {
                type: 'restoreScratchPadState',
                payload: {
                    expectedSections: previousPadSections,
                    replacementSections: settledPadSections,
                    expectedMarkerSections: liveMarkerSections,
                    replacementMarkerSections: liveMarkerSections,
                },
            },
        };
    },
    isNoop: hasNothingToCapture,
    undoable: true,
});
