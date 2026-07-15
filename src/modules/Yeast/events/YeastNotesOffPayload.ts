/** Plain app-event payload for routing Worker-generated Note Offs. */
export type YeastNotesOffPayload = {
    trackId: string;
    notes: number[];
};
