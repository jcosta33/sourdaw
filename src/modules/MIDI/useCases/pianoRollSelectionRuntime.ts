import { captureProjectIdentity, captureProjectRootIdentity } from '#/modules/CrdtDocument/stores';

import { type projectPianoRollTakeNotes } from './midiClipData/projectPianoRollTakeNotes';

export type Owner = {
    clipId: string;
    viewId: string;
    ownerClipId: string;
    storedNoteId: string;
    displayedStartBeat: number;
    displayedDuration: number;
    takeId?: string;
    occurrenceIndex?: number;
};
export type Projection = { clipId: string; projection: ReturnType<typeof projectPianoRollTakeNotes> };
export type PianoRollSelection = {
    clipId: string | null;
    clipIds: string[];
    viewIds: string[];
    status: 'resolved' | 'ambiguous' | 'unavailable';
    owners: Owner[];
    token: string;
};

const initialSelection: PianoRollSelection = {
    clipId: null,
    clipIds: [],
    viewIds: [],
    status: 'unavailable',
    owners: [],
    token: crypto.randomUUID(),
};
export function currentIdentity(): string {
    return JSON.stringify([captureProjectIdentity(), captureProjectRootIdentity()]);
}

export const pianoRollSelectionRuntime = { selection: initialSelection, projectIdentity: currentIdentity() };
