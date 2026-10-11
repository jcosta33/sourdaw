export type YeastNoteOffIdentity = {
    channel: number;
    note: number;
    /**
     * The generated voice instance this off retires (#4873). Present only when
     * the originating note carried one; routing resolves it against the
     * captured owner so the original instrument releases even after the track's
     * instrument changed. An off without one can only name the pitch.
     */
    noteInstanceId?: string;
    /** Sample frame the worker settled the voice at, when it carried one. */
    sampleFrame?: number;
};

/** Plain app-event payload for routing Worker-generated Note Offs. */
export type YeastNotesOffPayload = {
    trackId: string;
    noteOffs: YeastNoteOffIdentity[];
};
