export type YeastNoteOffIdentity = {
    channel: number;
    note: number;
    noteInstanceId?: string;
};

/** Plain app-event payload for routing Worker-generated Note Offs. */
export type YeastNotesOffPayload = {
    trackId: string;
    noteOffs: YeastNoteOffIdentity[];
};
