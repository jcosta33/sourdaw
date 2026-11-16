export type MidiClipNoteSnapshot = {
    readonly id: string;
    readonly pitch: number;
    readonly startBeat: number;
    readonly duration: number;
    readonly velocity: number;
    readonly probability?: number;
    readonly pressure?: number;
    readonly slide?: number;
    readonly pitchBend?: number;
    readonly pitchBendRangeSemitones?: number;
    readonly channel?: number;
    readonly articulation?: string;
    readonly expression?: MidiNoteExpressionSnapshot;
    /** Original recording pass, absent on legacy and manually edited notes. */
    readonly recordingPassIndex?: number;
};
export type MidiExpressionPointSnapshot = { readonly offsetBeats: number; readonly value: number };
export type MidiNoteExpressionSnapshot = {
    readonly pressure?: MidiExpressionPointSnapshot[];
    readonly slide?: MidiExpressionPointSnapshot[];
    readonly pitchBend?: MidiExpressionPointSnapshot[];
};
export type MidiClipCcSnapshot = {
    readonly id: string;
    readonly controller: number;
    readonly value: number;
    readonly beat: number;
    readonly channel: number;
};
export type MidiClipPitchBendSnapshot = {
    readonly id: string;
    readonly value: number;
    readonly beat: number;
    readonly channel: number;
    readonly channelScoped?: boolean;
};
export type MidiClipDataActionSnapshot = {
    readonly notes: { readonly present: boolean; readonly value: readonly MidiClipNoteSnapshot[] };
    readonly controlChanges: { readonly present: boolean; readonly value: readonly MidiClipCcSnapshot[] };
    readonly pitchBends: { readonly present: boolean; readonly value: readonly MidiClipPitchBendSnapshot[] };
};
/** Plain wire value: MIDI owns validation and all row projection. */
export type MidiTakeSourceSnapshot = {
    readonly sourceClipId: string;
    readonly rows: MidiClipDataActionSnapshot;
    readonly sourceEntryBeat: number;
    readonly sourceEndBeat: number;
    readonly phaseHeadBeat: number;
    readonly passLengthBeats: number;
    /** The first source beat the take may read: where a Delete Time cut its head. Absent means unbounded. */
    readonly readStartBeat?: number;
    /** The exclusive source beat the take may read up to: where a Delete Time cut its tail. Absent means unbounded. */
    readonly readEndBeat?: number;
    /**
     * How far before `phaseHeadBeat` the take's loop occurrences count from:
     * the pass head less the media origin live comp playback counted the take
     * from when it was captured. Held relative to the pass head so it moves
     * with the take. Absent on sources captured before it was recorded.
     */
    readonly occurrenceOriginDepthBeats?: number;
};
