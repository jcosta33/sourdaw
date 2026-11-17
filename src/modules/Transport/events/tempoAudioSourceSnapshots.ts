import { type ClipStateSnapshot, type TakeSnapshot } from '#/modules/Arrangement/events';
import { type AudioSourceSnapshot } from '#/utils/audioSourceTime';

/** Source facets captured by the Arrangement owner before a tempo edit.
 * These are bounded value deltas, never replacement tracks or take lanes. */
export type TempoAudioClipFieldsSnapshot = Pick<
    ClipStateSnapshot,
    | 'audioOffsetSeconds'
    | 'audioUnwrappedOffsetSeconds'
    | 'audioLoopStartSeconds'
    | 'audioLoopPassEntrySeconds'
    | 'audioLoopPassOriginBeat'
>;
export type TempoAudioClipInputsSnapshot = Pick<
    ClipStateSnapshot,
    | 'startBeat'
    | 'endBeat'
    | 'audioBufferId'
    | 'assetHash'
    | 'audioOffsetBeats'
    | 'loopEnabled'
    | 'loopLength'
    | 'loopOriginBeat'
    | 'stretchMode'
    | 'stretchRatio'
>;
export type TempoAudioTakeFieldsSnapshot = Pick<
    TakeSnapshot,
    'sourceOffsetSeconds' | 'passOriginBeat' | 'passOriginSourceSeconds'
>;
export type TempoAudioTakeInputsSnapshot = Pick<
    TakeSnapshot,
    'startBeat' | 'endBeat' | 'sourceOffsetBeats' | 'passAnchorSeconds' | 'passDepthSeconds' | 'passSourceEndSeconds'
>;
export type TempoAudioSourcePresenceSnapshot =
    { readonly present: false } | { readonly present: true; readonly value: AudioSourceSnapshot };
export type TempoAudioSourcePromotionSnapshot = {
    readonly version: 1;
    readonly clips: readonly {
        readonly trackId: string;
        readonly collection: 'active' | 'alternative';
        readonly alternativeId: string;
        readonly clipId: string;
        readonly inputs: TempoAudioClipInputsSnapshot;
        readonly before: TempoAudioClipFieldsSnapshot;
        readonly after: TempoAudioClipFieldsSnapshot;
    }[];
    readonly takes: readonly {
        readonly trackId: string;
        readonly laneId: string;
        readonly takeId: string;
        readonly clipId: string;
        readonly inputs: TempoAudioTakeInputsSnapshot;
        readonly before: TempoAudioTakeFieldsSnapshot;
        readonly after: TempoAudioTakeFieldsSnapshot;
    }[];
    readonly regions: readonly {
        readonly trackId: string;
        readonly laneId: string;
        readonly takeId: string;
        readonly clipId: string;
        readonly startBeat: number;
        readonly endBeat: number;
        readonly before: TempoAudioSourcePresenceSnapshot;
        readonly after: TempoAudioSourcePresenceSnapshot;
    }[];
    readonly gaps: readonly {
        readonly trackId: string;
        readonly laneId: string;
        readonly clipId: string;
        readonly startBeat: number;
        readonly endBeat: number;
        readonly before: TempoAudioSourcePresenceSnapshot;
        readonly after: TempoAudioSourcePresenceSnapshot;
    }[];
    readonly gapFieldPresence: readonly {
        readonly trackId: string;
        readonly laneId: string;
        readonly before: boolean;
        readonly after: boolean;
    }[];
};
