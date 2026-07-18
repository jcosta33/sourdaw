import { createStore } from '#/infra/store/createStore';

// Clip selection is arrangement truth (which clips / time range the user has
// selected), not layout state. It owns its own store here so the Arrangement→
// Workspace selection edge is severed (ADR 0011 Wave 2). Memory-backed like the
// former workspaceStore-hosted fields — selection is runtime-only, never persisted.

export type MarqueeSelection = {
    startBeat: number;
    endBeat: number;
    trackIds: string[];
};

export type ClipSelectionState = {
    selectedClipId: string | null;
    selectedClipIds: string[];
    marqueeSelection: MarqueeSelection | null;
};

export const defaultClipSelectionState: ClipSelectionState = {
    selectedClipId: null,
    selectedClipIds: [],
    marqueeSelection: null,
};

export const clipSelectionStore = createStore<ClipSelectionState>({
    initialData: defaultClipSelectionState,
});
