import { type DrumPreviewCandidateSnapshot, type DrumPreviewSourceClipSnapshot } from '#/utils/handlerContract';

type DrumPreviewSourceClip = {
    readonly id: string;
    readonly type: string;
    readonly name: string;
    readonly locked: boolean;
};

type DrumPreviewSourceTrack = {
    readonly id: string;
    readonly kind: string;
    readonly name: string;
    readonly frozen: boolean;
    readonly clips: readonly DrumPreviewSourceClip[];
};

/** The MIDI slot as the candidate branches copy it: every field is kept, the varying roles' notes replaced. */
type DrumPreviewMidiState = {
    notesByClipId: Record<string, unknown[]>;
};

type DrumPreviewCandidateNotesInput = {
    branchId: string;
    endBeat: number;
    notes: DrumPreviewSourceClipSnapshot['expectedNotes'];
    recipe: DrumPreviewCandidateSnapshot['recipe'];
    role: 'snare' | 'hi-hat';
    startBeat: number;
};

type DrumPreviewSourceReader = {
    readTracks: () => readonly DrumPreviewSourceTrack[];
    readMidiState: () => DrumPreviewMidiState | null;
    projectCandidateNotes: (input: DrumPreviewCandidateNotesInput) => readonly unknown[] | null;
};

let reader: DrumPreviewSourceReader | null = null;

/**
 * The arrangement and MIDI reads drum preview branches validate against and
 * derive from. The kernel may not import those domain modules, so the
 * composition root supplies them (`#/app/registerProjectSlotProjections`).
 * Unconfigured, preparing a preview throws rather than refusing every plan as
 * though its source clips had changed.
 */
export const drumPreviewSourcePort = {
    requireReader(): DrumPreviewSourceReader {
        if (reader === null) {
            throw new Error(
                'prepareDrumPreviewBranches: drum preview sources are not configured; call registerProjectSlotProjections() from #/app/registerProjectSlotProjections (bootstrap does this)'
            );
        }
        return reader;
    },
    setProvider(nextReader: DrumPreviewSourceReader | null): void {
        reader = nextReader;
    },
};
