import { type AutomationPointSnapshot } from '#/modules/Automation/events';
import { type MidiClipDataActionSnapshot } from '#/modules/MIDI/events';
import { type AudioSourceSnapshot } from '#/utils/audioSourceTime';

import { type StemImportRole } from '../models/StemImportRole';

import {
    type ClipAutomationLaneSnapshot,
    type ClipSatelliteEntrySnapshot,
    type ClipStateSnapshot,
} from './arrangementClipStateSnapshots';

export type ClipSnapshot = {
    readonly id: string;
    readonly trackId: string;
    readonly startBeat: number;
    readonly endBeat: number;
};
/** A ripple-shifted neighbor's pre-gesture placement, captured for exact restore. */
export type ClipShiftSnapshot = {
    readonly clipId: string;
    readonly origStartBeat: number;
    readonly origEndBeat: number;
};
export type ClipAutomationLaneActionSnapshot = {
    readonly id: string;
    readonly trackId: string;
    readonly points: readonly AutomationPointSnapshot[];
};
/** A saved source owner is bounded by the original take region or base gap.
 * It never grants ownership of the rest of a lane's programme. */
export type CompAudioSourceOwnerSnapshot =
    | {
          readonly kind: 'take';
          readonly takeId: string;
          readonly startBeat: number;
          readonly endBeat: number;
          readonly audioSource?: AudioSourceSnapshot;
      }
    | {
          readonly kind: 'base';
          readonly clipId: string;
          readonly startBeat: number;
          readonly endBeat: number;
          readonly audioSource?: AudioSourceSnapshot;
      };
export type CompAudioSourceInputProof = {
    readonly clipId: string;
    readonly startBeat: number;
    readonly endBeat: number;
    readonly digest: string;
    readonly media: { readonly audioBufferId?: string; readonly assetHash?: string };
};
export type ScratchPadSectionSnapshot = { readonly id: string };
export type MarkerSectionSnapshot = { readonly id: string };
/** Exact frozen copies and row placement admitted by one original-row edit. */
export type OriginalMidiTakeRowCopy = {
    readonly laneId: string;
    readonly takeId: string;
    readonly clipId: string;
    readonly sourceEntryBeat: number;
    readonly sourceEndBeat: number;
    readonly passLengthBeats: number;
    readonly recordingPassIndex?: number;
    readonly expectedSlotPresent: boolean;
    readonly replacementSlotPresent: boolean;
    readonly expectedNextRowId: string | null;
    readonly replacementNextRowId: string | null;
};
export type MidiClipGlueActionSnapshot = {
    readonly clips: readonly {
        readonly clipId: string;
        readonly data: MidiClipDataActionSnapshot;
    }[];
    readonly migratedAbsoluteNoteClipIds: {
        readonly present: boolean;
        readonly value: readonly string[];
    };
};
export type StripSilenceActionSnapshot = {
    readonly trackId: string;
    readonly clips: readonly ClipStateSnapshot[];
    readonly clipOrder: readonly string[];
    readonly clipSatellites: readonly ClipSatelliteEntrySnapshot[];
    readonly clipAutomationLanes: readonly ClipAutomationLaneSnapshot[];
};
/** One detected onset a transient quantize cut and moved: the slice it heads now starts at `toBeat`. */
export type TransientQuantizeMoveSnapshot = {
    readonly onsetIndex: number;
    readonly sliceClipId: string;
    /** The onset's position in the source file: the slice's exact `audioOffsetSeconds`. */
    readonly sourceSeconds: number;
    readonly confidence: number;
    readonly fromBeat: number;
    readonly toBeat: number;
};
/** One detected onset a transient quantize left uncut: `merged` when its grid point did not advance
 *  past the slice before it, `limit` when it fell past the onset cap. */
export type TransientQuantizeSkipSnapshot = {
    readonly onsetIndex: number;
    readonly reason: 'merged' | 'limit';
};
export type RippleShiftSnapshot = {
    readonly clipId: string;
    readonly origStartBeat: number;
    readonly origEndBeat: number;
    readonly automationDelta: number;
    /** Complete shifted-clip lane membership, owner tracks and points after
     *  the forward ripple. Historical captures without this field can only
     *  authenticate an empty live automation scope. */
    readonly expectedAutomationLanes?: readonly ClipAutomationLaneActionSnapshot[];
};
export type RipplePlanSnapshot = {
    readonly removedClips: readonly ClipSnapshot[];
    readonly shiftedClips: readonly RippleShiftSnapshot[];
    readonly clipSatellites: readonly ClipSatelliteEntrySnapshot[];
    readonly clipAutomationLanes: readonly ClipAutomationLaneSnapshot[];
};
export type AdjustmentLayerSnapshot = {
    readonly id: string;
    readonly name: string;
    readonly effectType:
        'eq' | 'compressor' | 'reverb' | 'delay' | 'saturation' | 'filter' | 'stereo-width' | 'volume' | 'pan';
    readonly parameters: readonly {
        readonly name: string;
        readonly value: number;
        readonly min: number;
        readonly max: number;
        readonly unit: string;
    }[];
    readonly affectedTrackIds: readonly string[];
    readonly insertionIndex: number;
    readonly regions: readonly {
        readonly id: string;
        readonly startBeat: number;
        readonly endBeat: number;
        readonly blend: number;
        readonly fadeInBeats: number;
        readonly fadeOutBeats: number;
    }[];
    readonly enabled: boolean;
    readonly mix: number;
    readonly color: string;
};
export type GeneratedMidiStateGuard = {
    entityJson: string;
    midiByClipIdJson: string;
    /**
     * Canonical JSON of the generated entity's per-clip satellite entries (gain
     * envelope, warp state), captured by producers whose generation writes
     * satellites — a clip duplicate clones the source's. Absent means the guard
     * requires the entity to carry no satellites at all, the pre-satellite
     * contract. When present, the guard instead requires the satellites to be
     * exactly what generation left behind, so undo refuses only after the user
     * has actually edited them.
     */
    clipSatellitesJson?: string;
    /**
     * Canonical JSON of the clip-scoped automation lanes the generated clips
     * carry, captured by producers whose generation writes them — a clip
     * duplicate clones the source's lanes onto the copy. A separate field from
     * `clipSatellitesJson` because the lanes live in Automation's store, not
     * the Arrangement satellite pair; either field may be captured without the
     * other, and an absent one keeps that leg on the absence check.
     */
    clipAutomationLanesJson?: string;
};
export type StemImportTrackSnapshot = {
    readonly stemId: string;
    readonly sourceName: string;
    readonly role: StemImportRole;
    readonly sourceTempo: number;
    readonly durationSeconds: number;
    readonly sourceBytes: number;
    readonly decodedBytes: number;
    readonly audioBufferId: string;
    readonly assetHash?: string;
    readonly assetLeaseId?: string;
    readonly trackId: string;
    readonly trackName: string;
    readonly trackGain: number;
    readonly trackPan: number;
    readonly trackColor?: string;
    readonly trackAlternativeId?: string;
    readonly clipId: string;
};
