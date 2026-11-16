import { type IncomingModulationMappingSnapshot, type ModulatorSnapshot } from '#/modules/Automation/events';
import { type MidiCcSnapshot, type MidiNotesSnapshot, type MidiPitchBendSnapshot } from '#/modules/MIDI/events';
import {
    type ClipAutomationLaneSnapshot,
    type ClipSatelliteEntrySnapshot,
    type ClipStateSnapshot,
    type RetiredTakeLaneSnapshot,
} from '#/utils/handlerContract';

import { type DeviceSnapshot } from '../models/DeviceSnapshot';

export type DeviceChainTopologySnapshot = {
    readonly id: string;
    readonly kind: 'audio' | 'midi' | 'bus' | 'master' | 'folder';
    readonly devices: readonly {
        readonly id: string;
        readonly type: string;
        readonly externalInstanceId?: string;
        readonly parameterIds: readonly string[];
    }[];
};
export type TrackSnapshot = { readonly id: string };
export type BatchRestoreTrackSnapshot = {
    readonly trackId: string;
    readonly trackIndex: number;
};
export type TrackSendSnapshot = {
    readonly busId: string;
    readonly level: number;
    readonly preFader: boolean;
};
export type TrackRoutingStateSnapshot = {
    readonly outputId: string;
    readonly sends: readonly TrackSendSnapshot[];
};
export type TrackRoutingPatchSnapshot = {
    readonly trackId: string;
    readonly expected: TrackRoutingStateSnapshot;
    readonly replacement: TrackRoutingStateSnapshot;
};
export type SidechainRouteSnapshot = {
    readonly id: string;
    readonly sourceTrackId: string;
    readonly targetTrackId: string;
    readonly targetDeviceId: string;
    readonly targetParameterId: string;
    readonly gain: number;
};
export type AutomationLaneSnapshot = { readonly id: string; readonly trackId: string };
export type TakeLaneSnapshot = { readonly id: string; readonly trackId: string };
/** Structural mirror of a track's whole freeze aggregate — the two denormalized fields
 *  plus `freezeState` itself. Kept structural, like every other snapshot here, so this
 *  neutral contract does not depend on a model owned by the Arrangement module.
 *
 *  Captured and restored as one unit because the three drift apart if they are not:
 *  `frozen` and `frozenBufferId` are what playback and export read, `freezeState` is what
 *  staleness detection and the freeze UI read, and a restore that collapsed the aggregate
 *  to `unfrozen` would discard a `stale` or `error` state the forward action found. */
export type FreezeStateSnapshot = {
    readonly frozen: boolean;
    readonly frozenBufferId?: string;
    readonly freezeState: {
        readonly status: 'unfrozen' | 'freezing' | 'frozen' | 'stale' | 'error';
        readonly freezeId?: string;
        readonly frozenBufferId?: string;
        readonly frozenAudioHash?: string;
        readonly sourceContentHash?: string;
        readonly deviceChainHash?: string;
        readonly renderSettings?: {
            readonly sampleRate: number;
            readonly bitDepth: number;
            readonly channelCount: number;
            readonly tailLengthSeconds: number;
            readonly bakeVersion?: number;
        };
        readonly compensationSeconds?: number;
        readonly renderProgress?: number;
        readonly errorMessage?: string;
        readonly renderedAt?: number;
    };
};
export type TrackKind = 'audio' | 'midi' | 'bus' | 'master' | 'folder';
/**
 * One track's clip collection plus the MIDI satellite state those clips own. Clip
 * edits that rewrite a whole track — cut, paste, strip silence, flatten, bounce —
 * cannot be inverted by replaying a counter-edit, so they carry this instead.
 */
/**
 * The track-level fields a collection rewrite overwrites alongside `clips`.
 * `flattenTrack` replaces all eight; a `destination: 'replace'` bounce empties
 * `devices`. Restoring `clips` without these hands back the right clips on a track
 * that lost its kind, its instrument and insert chain, its frozen take, and its
 * alternative lanes — a state the user never authored.
 */
export type TrackCollectionAlternativeSnapshot = {
    readonly id: string;
    /** Declared because `captureTrackClipStates` clones the whole live alternative and
     *  the restore writes the whole object back — so the name has always travelled and
     *  always been restored, and a narrower declaration only hid it from the guard.
     *  `renameTrackAlternative` writes exactly this field. */
    readonly name: string;
    /** Whole clips, for the same reason `TrackClipStateSnapshot.clips` carries them:
     *  the restore replaces each alternative's clip array outright, so the guard has
     *  to be able to see an edit *inside* one of those clips, not just its id. */
    readonly clips: readonly ClipStateSnapshot[];
};
export type TrackCollectionFieldsSnapshot = {
    readonly kind: TrackKind;
    /** Declared wide enough to be *compared*, not just written back: the guarded
     *  restore refuses when a device was added, removed, reordered, bypassed or
     *  reparameterised since capture, and it can only see that through these fields. */
    readonly devices: readonly DeviceSnapshot[];
    readonly frozen: boolean;
    readonly frozenBufferId?: string;
    readonly freezeState: FreezeStateSnapshot['freezeState'];
    readonly activeAlternativeId: string;
    /** Each alternative's clips travel with it for the same reason: the restore
     *  replaces the whole alternative list, so an edit inside a non-active
     *  alternative has to be visible to the guard that authorises that write. */
    readonly alternatives: readonly TrackCollectionAlternativeSnapshot[];
};
export type TrackClipStateSnapshot = {
    readonly trackId: string;
    /**
     * Declared wide enough to be *compared*, not just written back — the same reason
     * `TrackCollectionFieldsSnapshot.devices` is. `captureTrackClipStates` has always
     * put whole cloned clips here and the restore has always written the whole array
     * back, so a narrower declaration only ever hid that from the guard: an id
     * sequence is byte-identical across every in-place clip edit, and a guard that
     * can read no more than the id authorises overwriting all of them.
     */
    readonly clips: readonly ClipStateSnapshot[];
    /** Everything the rewrite overwrites besides `clips`. See the type's own note. */
    readonly trackFields: TrackCollectionFieldsSnapshot;
    readonly midiNotesByClipId: Record<string, MidiNotesSnapshot>;
    readonly midiCcByClipId: Record<string, MidiCcSnapshot>;
    readonly midiPitchBendByClipId: Record<string, MidiPitchBendSnapshot>;
    /**
     * Gain envelopes and warp markers hang off clip identity, so `removeClip` —
     * reached by cut, and by whatever a paste displaces — deletes them outright.
     * Carried here for the same reason `captureTrackRemovalSnapshot` carries them.
     */
    readonly clipSatellites: readonly ClipSatelliteEntrySnapshot[];
    /** Clip-scoped automation lanes, deleted by the same `removeClipSatelliteData` path. */
    readonly clipAutomationLanes: readonly ClipAutomationLaneSnapshot[];
    /**
     * The take lanes this snapshot's forward action retires — `removeClip` takes
     * the retired clip's takes with it, and only a capture made before that write
     * can put them back. Carried on the pre-removal snapshot; the post-removal
     * capture carries none. Optional so snapshots persisted before takes joined
     * this payload still decode; absent means the action retired no takes.
     */
    readonly retiredTakeLanes?: readonly RetiredTakeLaneSnapshot[];
};
/** Everything `removeTrack` deletes, so one track can be put back exactly as it was. */
export type RestoreTrackPayloadSnapshot = {
    trackId: string;
    trackSnapshot: TrackSnapshot;
    trackName: string;
    trackKind: TrackKind;
    trackGain: number;
    trackParentId: string | null;
    trackIndex: number;
    /** Internal context compiled only for sibling restores captured by one atomic batch. */
    batchRestoreTracks?: readonly BatchRestoreTrackSnapshot[];
    wasSelected: boolean;
    routingPatches: readonly TrackRoutingPatchSnapshot[];
    automationLaneSnapshots: readonly AutomationLaneSnapshot[];
    clipSatellites: readonly ClipSatelliteEntrySnapshot[];
    midiNotesByClipId: Record<string, MidiNotesSnapshot>;
    midiCcByClipId: Record<string, MidiCcSnapshot>;
    midiPitchBendByClipId: Record<string, MidiPitchBendSnapshot>;
    takeLaneSnapshots: readonly TakeLaneSnapshot[];
    sidechainRouteSnapshots: readonly SidechainRouteSnapshot[];
    ownedModulatorSnapshots: readonly ModulatorSnapshot[];
    incomingModulationMappingSnapshots: readonly IncomingModulationMappingSnapshot[];
};
