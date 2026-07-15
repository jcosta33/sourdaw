/** Plain app-event payload for routing worklet-generated Note Offs. */
export type YeastNotesOffPayload = {
    trackId: string;
    notes: number[];
};
