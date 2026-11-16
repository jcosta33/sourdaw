import { type AutomationPointSnapshot } from '#/modules/Automation/events';
import { type MidiClipDataActionSnapshot, type MidiTakeSourceSnapshot } from '#/modules/MIDI/events';
import { type AudioSourceSnapshot, type AudioSourceTile } from '#/utils/audioSourceTime';

export type ClipStateSnapshot = {
    readonly id: string;
    readonly trackId: string;
    readonly name: string;
    readonly startBeat: number;
    readonly endBeat: number;
    readonly type: 'audio' | 'midi';
    readonly audioBufferId?: string;
    readonly fileId?: string;
    readonly assetHash?: string;
    readonly audioOffsetBeats?: number;
    readonly audioOffsetSeconds?: number;
    readonly audioUnwrappedOffsetSeconds?: number;
    readonly audioLoopStartSeconds?: number;
    readonly audioLoopPassEntrySeconds?: number;
    readonly audioLoopPassOriginBeat?: number;
    readonly midiOffsetBeats?: number;
    readonly fadeInBeats: number;
    readonly fadeOutBeats: number;
    readonly gain: number;
    readonly color: string;
    readonly locked: boolean;
    readonly muted: boolean;
    readonly stretchMode?: 'off' | 'repitch' | 'timestretch';
    readonly stretchRatio?: number;
    readonly loopEnabled?: boolean;
    readonly loopLength?: number;
    readonly loopOriginBeat?: number;
    readonly followAction?: 'stop' | 'play_next' | 'play_previous' | 'play_random' | 'play_first' | 'play_last';
    readonly generating?: boolean;
    readonly isGhost?: boolean;
    readonly isInlineEditing?: boolean;
    readonly parentClipId?: string;
    readonly isLinkedInstance?: boolean;
    readonly sourceKeyRoot?: number;
    readonly sourceScaleName?: string;
    readonly overrides?: Readonly<Record<string, boolean>>;
    readonly kneadState?: {
        readonly blobs: {
            readonly id: string;
            readonly startTime: number;
            readonly endTime: number;
            readonly pitchCenterCents: number;
            readonly originalPitchCenterCents?: number;
            readonly pitchCurveCents: number[];
            readonly voicedConfidence: number;
        }[];
        readonly retuneSpeedMs: number;
        readonly humanizePercent: number;
        readonly formantPreserve: boolean;
    };
};
export type ClipSatelliteWarpMarkerSnapshot = {
    readonly id: string;
    readonly originalBeat: number;
    readonly warpedBeat: number;
    readonly origin?: 'user' | 'transient-auto' | 'grid-snap';
    readonly confidence?: number;
    readonly locked?: boolean;
};
export type ClipSatelliteWarpStateSnapshot = {
    readonly enabled: boolean;
    readonly markers: readonly ClipSatelliteWarpMarkerSnapshot[];
    /**
     * Wire union: the canonical ADR 0024 ids this build writes, plus the
     * pre-ADR legacy ids (`complex`, `texture`, `beats`) that versioned
     * command envelopes recorded by earlier builds still carry. Validation
     * admits the union; the satellite store decodes legacy ids back onto the
     * canonical set at the write boundary (`normalizeWarpState`), so
     * in-memory state always stays canonical.
     */
    readonly stretchMode: 'repitch' | 'phase-vocoder' | 'wsola' | 'complex' | 'texture' | 'beats';
    readonly originalTempo: number | null;
};
export type ClipSatelliteGainEnvelopePointSnapshot = {
    readonly id: string;
    readonly beatOffset: number;
    readonly gainDb: number;
};
export type ClipSatelliteGainEnvelopeSnapshot = {
    readonly clipId: string;
    readonly points: readonly ClipSatelliteGainEnvelopePointSnapshot[];
    readonly enabled: boolean;
};
/** A clip's gain envelope and warp state — the per-clip satellites owned by
 *  the `clipSatelliteState` store pair. Kept structural, not the store's model,
 *  because models never cross the module boundary. */
export type ClipSatelliteEntrySnapshot = {
    readonly clipId: string;
    readonly gainEnvelope: ClipSatelliteGainEnvelopeSnapshot | null;
    readonly warpState: ClipSatelliteWarpStateSnapshot | null;
};
/** A bounded automation container owned by one lane, carried verbatim inside
 *  `ClipAutomationLaneSnapshot`. */
export type ClipAutomationObjectSnapshot = {
    readonly id: string;
    readonly laneId: string;
    readonly startBeat: number;
    readonly endBeat: number;
    readonly points: readonly AutomationPointSnapshot[];
    readonly poolId?: string;
    readonly loopLength?: number;
    readonly overrides?: Readonly<Record<string, boolean>>;
    readonly name: string;
};
/** A WHOLE clip-scoped automation lane, carried by the clip-identity actions
 *  (`stripSilence`, `glueClips`, `restoreClip`) whose inverses must be able to
 *  put a retired lane back exactly as it was. Unlike `AutomationLaneSnapshot`
 *  — an id-only reference used where the lane still lives in its own store —
 *  every field of Automation's `AutomationLane` is declared here, because the
 *  generated argument schema closes each object (`additionalProperties: false`)
 *  and an undeclared field makes the whole envelope unallowlisted. Kept
 *  structural (not imported from Automation's models), because models never
 *  cross the module boundary. */
export type ClipAutomationLaneSnapshot = {
    readonly id: string;
    readonly trackId: string;
    readonly clipId?: string;
    readonly clipAutomationMode?: 'additive' | 'multiplicative';
    readonly parameterId: string;
    readonly parameterName: string;
    readonly points: readonly AutomationPointSnapshot[];
    readonly trimPoints?: readonly AutomationPointSnapshot[];
    readonly objects: readonly ClipAutomationObjectSnapshot[];
    readonly ghostPoints?: readonly AutomationPointSnapshot[];
    readonly visible: boolean;
    readonly enabled: boolean;
    readonly collapsed: boolean;
    readonly linkedLaneId?: string;
    readonly linkScale?: number;
    readonly minValue: number;
    readonly maxValue: number;
    readonly viewMinValue?: number;
    readonly viewMaxValue?: number;
    readonly color?: string;
};
export type ClipSplitActionSnapshot = {
    /** Old clip-start tempo that authenticates audio source promotion on both replay facets. */
    readonly audioSourceTempoAtStart?: number;
    readonly trackId: string;
    readonly leftClip: ClipStateSnapshot;
    readonly rightClip: ClipStateSnapshot | null;
    readonly rightClipIndex: number;
    /** Relative insertion witnesses, refreshed only by a committed Undo. Absent in legacy captures. */
    readonly rightClipOrder?: string[];
    readonly sourceMidi: MidiClipDataActionSnapshot;
    readonly rightMidi: MidiClipDataActionSnapshot;
    /**
     * The source clip's gain envelope and warp state, already repartitioned
     * across both halves. Optional so split actions captured before satellites
     * joined this snapshot still decode. On the undo leg (`previous`) the list
     * carries an explicit null entry for the right clip id, so restoring it
     * clears the right half's satellites rather than leaving them behind.
     */
    readonly clipSatellites?: readonly ClipSatelliteEntrySnapshot[];
    /**
     * The right fragment's clip-scoped automation lanes, copied from the
     * source and clamped to its window. Scoped to the RIGHT clip id only —
     * the left half keeps its id and its lanes untouched. Optional so split
     * actions captured before lanes joined this snapshot still decode; the
     * pre-split side carries an explicit empty list, so restoring it retires
     * the copies rather than leaving them behind.
     */
    readonly clipAutomationLanes?: readonly ClipAutomationLaneSnapshot[];
};
/** A take captured inside a comp take lane — structural mirror of the `Take`
 *  model, which never crosses the module boundary. Arrays stay mutable so a
 *  snapshot is assignable where the take-lane store's concrete model is
 *  expected. */
export type TakeSnapshot = {
    id: string;
    clipId: string;
    name: string;
    startBeat: number;
    endBeat: number;
    selected: boolean;
    sourceOffsetBeats?: number;
    sourceOffsetSeconds?: number;
    passAnchorSeconds?: number;
    passDepthSeconds?: number;
    passSourceEndSeconds?: number;
    passOriginBeat?: number;
    passOriginSourceSeconds?: number;
    /** Original recording pass, absent on legacy and manually made takes. */
    recordingPassIndex?: number;
    midiSource?: MidiTakeSourceSnapshot;
};
/** A comp region naming a take — structural mirror of the `CompRegion` model. */
export type CompRegionSnapshot = {
    startBeat: number;
    endBeat: number;
    takeId: string;
    audioSource?: AudioSourceSnapshot;
};
/** A whole comp take lane — structural mirror of the `TakeLane` model. */
export type CompTakeLaneSnapshot = {
    id: string;
    trackId: string;
    automationLaneId?: string;
    takes: TakeSnapshot[];
    activeCompRegions: CompRegionSnapshot[];
    baseGapAudioSources?: AudioSourceTile[];
};
/** One lane a clip removal emptied or thinned, carried by `restoreClip` as it
 *  was before the removal together with the index it held, so undoing the
 *  removal can put the same lane back in the same place. */
export type RetiredTakeLaneSnapshot = {
    readonly laneIndex: number;
    readonly lane: CompTakeLaneSnapshot;
    /**
     * The take ids this removal actually retired from `lane`. An undo re-adds only
     * these, so a captured take absent from live for any other reason — a later
     * deletion projected in with no local undo entry — stays absent instead of
     * being resurrected. Optional so captures persisted before the field existed
     * still decode; absent means the removal recorded no ids and an undo re-adds
     * no take from this lane.
     */
    readonly retiredTakeIds?: readonly string[];
    /** Exact source tiles this retirement removed; absent on legacy captures. */
    readonly retiredBaseGapAudioSources?: readonly AudioSourceTile[];
};
