import { isDeviceReleaseAdmitted } from '#/infra/release/deviceReleaseAdmission';
import { trackStore } from '#/modules/Arrangement/stores';
import { getSynthParamsForTrack, resolveClipsWithComping } from '#/modules/Arrangement/useCases';
import {
    applyNoteExpression,
    ensureTrackStrip,
    getAudioContext,
    getCompensationDelay,
    getCurrentTime,
    getDefaultBendRangeSemitones,
    registerScheduledSource,
    scheduleFaustNote,
} from '#/modules/AudioEngine/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { getAutomationValueAtBeat, isRecordingAutomation } from '#/modules/Automation/useCases';
import { midiStore, type MidiStoreState } from '#/modules/MIDI/stores';
import {
    getChordAtBeat,
    projectClipMidiEvents,
    projectCommittedGroove,
    resolveMidiNoteArticulationId,
    shouldPlayMidiEvent,
    transposeForChordTrack,
} from '#/modules/MIDI/useCases';
import { isFaustInstrumentModule } from '#/modules/PluginHost/useCases';
import { scheduleDrumKitNote, scheduleKitNote, scheduleNote } from '#/modules/Synth/useCases';
import { toasterStore } from '#/modules/Toaster/stores';
import { projectClipLoopExpansion } from '#/utils/clipLoopProjection';
import { MAX_MIDI_DATA_7BIT, PITCH_BEND_MAX, PITCH_BEND_MIN } from '#/utils/midiData';
import { resolveToasterPadIndex, TOASTER_NEUTRAL_MIDI_NOTE } from '#/utils/toasterNoteProjection';
import { getToasterSwingOffsetBeats } from '#/utils/toasterSwingProjection';

import { BEAT_EPSILON, beatToSamples } from '../../models/TempoMap';
import { type TransportState } from '../../models/TransportState';
import {
    forgetStoredControllersClipMuteWithheld,
    forgetStoredControllersTrackMuteWithheld,
    hasStoredControllersTrackMuteWithheld,
    noteStoredControllersClipMuteWithheld,
    noteStoredControllersTrackMuteWithheld,
    readStoredControllersClipMuteWithheld,
    storedControllerDeviceKey,
} from '../../services/storedControllerEngagement';
import { tempoMapStore } from '../../stores/tempoMapStore';
import { timeSignatureMapStore } from '../../stores/timeSignatureMapStore';
import { schedulerSession } from '../playheadScheduler/schedulerSession';

import { listMutedMidiClips } from './listMutedMidiClips';
import { processLiveYeastTrackBlock, type LiveYeastIteration, type LiveYeastNote } from './processLiveYeastTrackBlock';
import { releaseUnrestoredStoredControllers } from './releaseUnrestoredStoredControllers';
import { resolveDrumKit } from './resolveDrumKit';
import { resolveDrumKitDef } from './resolveDrumKitDef';
import { resolveStoredControllerClips } from './resolveStoredControllerClips';
import { restoreStoredControllers } from './restoreStoredControllers';
import { createSameFramePostQueue } from './sameFramePostQueue';
import { scheduleFrozenTrack } from './scheduleFrozenTrack';
import { scheduleStoredControllers } from './scheduleStoredControllers';
import { selectMidiClipsForSchedulerWindow } from './selectMidiClipsForSchedulerWindow';
import { selectMidiNotesForLoopWindow } from './selectMidiNotesForLoopWindow';

// Worklet synth device types that share a common noteOn/noteOff controls interface.
// Each entry maps a device type to the controls property name on the device node
// and an optional velocity transform (defaults to identity).
type WorkletSynthEntry = {
    controlsKey: 'fermenterControls' | 'grandBouleControls' | 'levainControls' | 'crumbsControls';
    velocityTransform?: (velocity: number) => number;
};

const WORKLET_SYNTH_DEVICES: Record<string, WorkletSynthEntry> = {
    fermenter: { controlsKey: 'fermenterControls' },
    'grand-boule': {
        controlsKey: 'grandBouleControls',
        velocityTransform: (value: number) => value / 127,
    },
    levain: { controlsKey: 'levainControls' },
    // Crumbs' catalog id carries the `builtin-` prefix. Without this row a
    // Crumbs track fell through to the built-in fallback synth here while the
    // offline render voiced the real sampler — the same live/offline split the
    // device's export refusal was hiding, just pointing the other way.
    'builtin-crumbs': { controlsKey: 'crumbsControls' },
};

// The three note-voicing categories, each a single first match. The note loop
// below calls exactly these to pick the device it dispatches to, and
// `resolveNoteVoicingDevice` calls them in the same order to name that device
// without a node. Two copies of a priority order drift; one does not.
function findToasterDevice<TDevice extends { type: string }>(devices: readonly TDevice[]): TDevice | undefined {
    return devices.find((device) => device.type === 'toaster');
}

function findWorkletSynthDevice<TDevice extends { type: string }>(devices: readonly TDevice[]): TDevice | undefined {
    return devices.find((device) => device.type in WORKLET_SYNTH_DEVICES);
}

function findFaustInstrumentDevice<TDevice extends { type: string }>(devices: readonly TDevice[]): TDevice | undefined {
    return devices.find((device) => isFaustInstrumentModule(device.type));
}

type SchedulerTrack = NonNullable<(typeof trackStore)['value']>['tracks'][number];
type SchedulerTrackStrip = ReturnType<typeof ensureTrackStrip>;

/**
 * The toaster a track's notes are dispatched to, when one has live controls: the
 * track's own, or its parent's when the parent carries one (a child is a pad of the
 * parent's kit, numbered among the parent's children).
 */
function resolveToasterTarget(
    track: SchedulerTrack,
    tracks: readonly SchedulerTrack[],
    strip: SchedulerTrackStrip
): {
    ownerTrack: SchedulerTrack;
    device: SchedulerTrack['devices'][number];
    pad: number;
    controls: ToasterControls;
} | null {
    let ownerTrack = track;
    let device = findToasterDevice(track.devices);
    let pad = -1;
    const parentTrack = track.parentId ? tracks.find((candidate) => candidate.id === track.parentId) : undefined;
    const parentDevice = parentTrack ? findToasterDevice(parentTrack.devices) : undefined;
    if (parentTrack && parentDevice) {
        ownerTrack = parentTrack;
        device = parentDevice;
        pad = tracks.filter((candidate) => candidate.parentId === parentTrack.id).findIndex((c) => c.id === track.id);
    }
    if (!device) {
        return null;
    }
    const toasterDevice = device;
    const ownerStrip = ownerTrack.id === track.id ? strip : ensureTrackStrip(ownerTrack.id);
    const node = ownerStrip.deviceNodes.find((data) => data.deviceId === toasterDevice.id || data.type === 'toaster');
    return node?.toasterControls ? { ownerTrack, device: toasterDevice, pad, controls: node.toasterControls } : null;
}

/**
 * The device and node a track's stored controllers are posted to, or null when the
 * window would post them nowhere. The one decision the window and a relocation's
 * restore (inside a clip or across a gap) share: only the instruments that honour
 * stored controllers take any, and only through the note path's own dispatch, so a
 * Yeast-routed, drum-kit or Toaster track, or one whose instrument has no node,
 * sends its notes elsewhere and its controllers nowhere.
 */
function resolveStoredControllerDevice(
    track: SchedulerTrack,
    tracks: readonly SchedulerTrack[]
): { device: SchedulerTrack['devices'][number]; node: SchedulerTrackStrip['deviceNodes'][number] } | null {
    if (
        track.devices.some((candidate) => candidate.type === 'yeast') ||
        resolveDrumKitDef(track.devices) ||
        resolveDrumKit(track.devices)
    ) {
        return null;
    }
    const strip = ensureTrackStrip(track.id);
    if (resolveToasterTarget(track, tracks, strip)) {
        return null;
    }
    const device = findWorkletSynthDevice(track.devices);
    if (!device || (device.type !== 'grand-boule' && device.type !== 'levain')) {
        return null;
    }
    const node = strip.deviceNodes.find((candidate) => candidate.deviceId === device.id);
    return node ? { device, node } : null;
}

/**
 * The one device on this rack that would voice the track's notes.
 *
 * A rack does not get scanned for "anything note-capable". The note loop
 * resolves one candidate per category in a fixed order and dispatches to
 * whichever resolves first, with no fall-through to a second candidate of the
 * same category — so a rack of `[fermenter, grand-boule]` is a `fermenter`
 * track, and the Grand Boule behind it is never in the note's signal path. A
 * predicate that matched either one would let the device further back answer
 * questions about a device it does not stand in for.
 *
 * Effects are not a category here, deliberately. A MIDI track whose rack holds
 * only effects is *supposed* to reach the builtin fallback synth, so letting an
 * effect answer would invent a new defect rather than fix one — the same MD-4
 * shape `acceptsNotes` prevents offline.
 *
 * Drum kits are absent for a different reason: `resolveDrumKitDef` and
 * `resolveDrumKit` read `track.devices` and need no node, so a kit voices its
 * samples either way and its branch runs ahead of the fallback regardless.
 * Whether admission should gate sample kits at all is a separate question about
 * a separate mechanism.
 *
 * Resolved without consulting `strip.deviceNodes`, which is what keeps this
 * answerable for a device that has no node. The note loop *does* cross from one
 * category to the next when a node is missing; that crossing is exactly the
 * environment-failure case, where reaching the fallback is the behaviour we
 * intend to keep.
 */
function resolveNoteVoicingDevice<TDevice extends { type: string }>(devices: readonly TDevice[]): TDevice | undefined {
    return findToasterDevice(devices) ?? findWorkletSynthDevice(devices) ?? findFaustInstrumentDevice(devices);
}

type NoteVoicingLookupTrack = {
    id: string;
    parentId?: string | null;
    devices: readonly { type: string }[];
};

/**
 * The device that would voice this track's notes, when the build refuses to
 * provide it.
 *
 * Asked of release admission rather than of `strip.deviceNodes`, and the
 * difference is the whole point. A node can be missing because the device is
 * withheld or because it failed to construct for an environment reason — a
 * missing wasm asset, an unavailable worklet — and those two must not share an
 * outcome. A runtime failure keeps the behaviour it has always had, including
 * the fallback synth, because the device was supposed to work and the user can
 * fix it. A withheld device is never going to work in this build, so voicing
 * its part on a sawtooth misrepresents the project every time it is played.
 *
 * It takes the track rather than a device list because for one topology the
 * voicing device is not on the track at all. A toaster child's notes are
 * dispatched to the *parent's* toaster device — the note loop reassigns
 * `toasterOwnerTrack` to `track.parentId` — so a lookup over `track.devices`
 * alone would answer "nothing withheld" for a child under a withheld toaster
 * and hand its part straight to the fallback synth. That is the defect this
 * whole guard exists to close, so it must not survive in a corner of it.
 *
 * The track's own devices are asked first, and the parent only if they answer
 * nothing.
 *
 * **A result here is not a claim that the track is silent.** It names the
 * withheld device the track would otherwise have been voiced on, and its only
 * sanctioned use is the terminal fallback branch: suppressing the builtin synth
 * and the `getSynthParamsForTrack` call that configures it. Do not read it as
 * audibility anywhere else, because for one topology the track sounds with this
 * set — a child whose own rack holds a withheld instrument, under a parent
 * carrying an *admitted* toaster with a live node. The own arm returns the
 * child's device, but the dispatch gives the parent's toaster precedence over
 * the child's whole rack: the parent branch reassigns `toasterDevice`, and both
 * the worklet and Faust categories are gated on `!toasterRoute`. So the notes
 * audibly reach the toaster while this reports a withheld device.
 *
 * That is the right sound — the toaster is what the dispatch selects — and it is
 * harmless today only because both consumers sit on a branch the toaster route
 * preempts. A second consumer that treats this as "the track is silent", a
 * warning or a freeze refusal, would be wrong about exactly that track. Such a
 * consumer needs the dispatch's precedence, not this flag.
 */
function findWithheldNoteVoicingDevice(
    track: NoteVoicingLookupTrack,
    tracks: readonly NoteVoicingLookupTrack[]
): { type: string } | undefined {
    // The device the dispatch would actually select — not whichever withheld
    // device happens to be findable. Asking the second question suppresses the
    // fallback over a device that was never going to be reached, which takes an
    // admitted instrument that merely failed to construct and strips it of the
    // fallback this guard exists to preserve for it.
    const own = resolveNoteVoicingDevice(track.devices);
    if (own && !isDeviceReleaseAdmitted(own.type)) {
        return own;
    }
    if (!track.parentId) {
        return undefined;
    }
    // Mirrors the note loop's own parent resolution: a parent counts as the
    // owner only when it actually carries a toaster device.
    const parentTrack = tracks.find((candidate) => candidate.id === track.parentId);
    const parentToaster = parentTrack ? findToasterDevice(parentTrack.devices) : undefined;
    if (!parentToaster || isDeviceReleaseAdmitted(parentToaster.type)) {
        return undefined;
    }
    return parentToaster;
}

export type SchedulerCancellation = {
    generation: number;
    /** Semantic timeline identity; unlike generation, loop wraps and jumps advance it without cancellation. */
    discontinuityEpoch: number;
    isCurrent: () => boolean;
    yeastRouteLineage: Map<string, LiveYeastIteration>;
};

/** Toaster parent-device note controls shape (local — cross-module model isolation). */
type ToasterControls = {
    noteOn: (pad: number, velocity: number, pitchNote: number, sampleFrame?: number) => void;
};

type GetSourceOccurrenceOffsetInput = {
    sourceStartBeat: number;
    segmentStartBeat: number;
    loopLength: number;
    loopEnabled: boolean;
};

/** Local view of the built-in synth's MPE params (cross-module model isolation). */
type ScheduledMpeParams = {
    pressure?: number;
    slide?: number;
    pitchBend?: number;
    pitchBendRangeSemitones?: number;
};

type ScheduledMidiNote = MidiStoreState['notesByClipId'][string][number];
type ScheduledMidiNoteIndex = {
    maxDurationBeats: number;
    maxEndpointBeat: number;
    minEndpointBeat: number;
    orderByNote: ReadonlyMap<ScheduledMidiNote, number>;
    sortedNoteEnds: readonly ScheduledMidiNote[];
    sortedNotes: readonly ScheduledMidiNote[];
};
type SelectMidiNotesForSchedulerWindowInput = {
    notes: readonly ScheduledMidiNote[];
    iterationStartBeat: number;
    midiOffsetBeats: number;
    fromBeat: number;
    toBeat: number;
};
type SelectYeastNotesForSchedulerWindowInput = {
    notes: readonly ScheduledMidiNote[];
    iterationStartBeat: number;
    midiOffsetBeats: number;
    loopEnabled: boolean;
    loopLengthBeats: number;
    fromBeat: number;
    toBeat: number;
};
type YeastLoopPhaseEntry = {
    endPhaseBeat: number;
    note: ScheduledMidiNote;
    phaseBeat: number;
};
type YeastLoopPhaseIndex = {
    loopLengthBeats: number;
    midiOffsetBeats: number;
    orderByNote: ReadonlyMap<ScheduledMidiNote, number>;
    sortedEnds: readonly YeastLoopPhaseEntry[];
    sortedEntries: readonly YeastLoopPhaseEntry[];
};
type ScheduledIterationRange = {
    endIndex: number;
    startIndex: number;
};
type GetScheduledIterationRangeInput = {
    clipStartBeat: number;
    fromBeat: number;
    iterationCount: number;
    loopEnabled: boolean;
    loopLengthBeats: number;
    toBeat: number;
};

const MAX_GROOVE_STAGE_DISPLACEMENT_BEATS = 0.25;
// Clip and sequencer groove each move a note by at most 0.25 beats, so one beat
// is twice their combined legal displacement and cannot discard a note that
// either groove stage could move into the current scheduler grain.
const MIDI_NOTE_GROOVE_LOOKAROUND_BEATS = 1;
// MIDI writes replace note arrays rather than mutating them, so array identity
// invalidates this cache whenever project truth changes.
const scheduledMidiNoteIndexes = new WeakMap<readonly ScheduledMidiNote[], ScheduledMidiNoteIndex>();
// Same invalidation rule for the looped-iteration phase view below.
const yeastLoopPhaseIndexes = new WeakMap<readonly ScheduledMidiNote[], YeastLoopPhaseIndex>();

function positiveModulo(value: number, divisor: number): number {
    return ((value % divisor) + divisor) % divisor;
}

function getScheduledMidiNoteIndex(notes: readonly ScheduledMidiNote[]): ScheduledMidiNoteIndex {
    const cached = scheduledMidiNoteIndexes.get(notes);
    if (cached) {
        return cached;
    }

    const orderByNote = new Map(notes.map((note, index) => [note, index]));
    const sortedNotes = [...notes].sort((left, right) => left.startBeat - right.startBeat);
    const sortedNoteEnds = [...notes].sort(
        (left, right) => left.startBeat + left.duration - right.startBeat - right.duration
    );
    const created = {
        maxDurationBeats: notes.reduce((maximum, note) => Math.max(maximum, note.duration), 0),
        maxEndpointBeat: notes.reduce(
            (maximum, note) => Math.max(maximum, note.startBeat, note.startBeat + note.duration),
            Number.NEGATIVE_INFINITY
        ),
        minEndpointBeat: notes.reduce(
            (minimum, note) => Math.min(minimum, note.startBeat, note.startBeat + note.duration),
            Number.POSITIVE_INFINITY
        ),
        orderByNote,
        sortedNoteEnds,
        sortedNotes,
    };
    scheduledMidiNoteIndexes.set(notes, created);
    return created;
}

function lowerBoundMidiNoteStart(notes: readonly ScheduledMidiNote[], startBeat: number): number {
    let low = 0;
    let high = notes.length;
    while (low < high) {
        const middle = low + Math.floor((high - low) / 2);
        if (notes[middle]!.startBeat < startBeat) {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    return low;
}

function lowerBoundMidiNoteEnd(notes: readonly ScheduledMidiNote[], endBeat: number): number {
    let low = 0;
    let high = notes.length;
    while (low < high) {
        const middle = low + Math.floor((high - low) / 2);
        const note = notes[middle]!;
        if (note.startBeat + note.duration < endBeat) {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    return low;
}

function selectMidiNotesForSchedulerWindow({
    notes,
    iterationStartBeat,
    midiOffsetBeats,
    fromBeat,
    toBeat,
}: SelectMidiNotesForSchedulerWindowInput): readonly ScheduledMidiNote[] {
    const { maxDurationBeats, orderByNote, sortedNotes } = getScheduledMidiNoteIndex(notes);
    const schedulesClipBoundary = iterationStartBeat >= fromBeat && iterationStartBeat < toBeat;
    const leadingIntervalLookbehindBeats = schedulesClipBoundary ? maxDurationBeats : 0;
    const sourceStartBeat =
        fromBeat -
        iterationStartBeat +
        midiOffsetBeats -
        MIDI_NOTE_GROOVE_LOOKAROUND_BEATS -
        leadingIntervalLookbehindBeats;
    const sourceEndBeat = toBeat - iterationStartBeat + midiOffsetBeats + MIDI_NOTE_GROOVE_LOOKAROUND_BEATS;
    const startIndex = lowerBoundMidiNoteStart(sortedNotes, sourceStartBeat);
    const endIndex = lowerBoundMidiNoteStart(sortedNotes, sourceEndBeat);
    const candidates = sortedNotes.slice(startIndex, endIndex);
    candidates.sort((left, right) => orderByNote.get(left)! - orderByNote.get(right)!);
    return candidates;
}

function lowerBoundYeastLoopPhase(entries: readonly YeastLoopPhaseEntry[], phaseBeat: number): number {
    let low = 0;
    let high = entries.length;
    while (low < high) {
        const middle = low + Math.floor((high - low) / 2);
        if (entries[middle]!.phaseBeat < phaseBeat) {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    return low;
}

function lowerBoundYeastLoopEnd(entries: readonly YeastLoopPhaseEntry[], endPhaseBeat: number): number {
    let low = 0;
    let high = entries.length;
    while (low < high) {
        const middle = low + Math.floor((high - low) / 2);
        if (entries[middle]!.endPhaseBeat < endPhaseBeat) {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    return low;
}

/**
 * Phase view of the content a looped iteration wraps: the class the ownership
 * re-anchors with the twin's positive modulo instead of clamping — starts
 * already before the iteration head, plus starts within one groove stage's
 * displacement after it, which the clip groove can pull across the head
 * (`MAX_GROOVE_STAGE_DISPLACEMENT_BEATS` bounds that displacement; the twin
 * grooves each candidate first and re-anchors only what lands before the head,
 * so a note pulled back inside sounds un-wrapped, and a raw start in
 * `[0, displacement)` indexes at its own position — the phase window's groove
 * slack is what reaches it from the late phase the twin anchors it to). Notes
 * are indexed by their wrapped position (`phaseBeat`) and wrapped release
 * (`endPhaseBeat`). The release stays uncapped: a note longer than its loop
 * rings past the iteration end and the owning window follows the release, as
 * the loop-work bounds spec pins. A start in `[0, displacement)` carries a
 * second release entry one loop past its phase — only the groove can wrap it,
 * and the wrapped release then rings a loop past the raw `endPhaseBeat`.
 */
function getYeastLoopPhaseIndex({
    notes,
    loopLengthBeats,
    midiOffsetBeats,
}: Pick<
    SelectYeastNotesForSchedulerWindowInput,
    'notes' | 'loopLengthBeats' | 'midiOffsetBeats'
>): YeastLoopPhaseIndex {
    const cached = yeastLoopPhaseIndexes.get(notes);
    if (cached?.loopLengthBeats === loopLengthBeats && cached.midiOffsetBeats === midiOffsetBeats) {
        return cached;
    }

    const orderByNote = new Map<ScheduledMidiNote, number>();
    const sortedEntries: YeastLoopPhaseEntry[] = [];
    const sortedEnds: YeastLoopPhaseEntry[] = [];
    for (let index = 0; index < notes.length; index++) {
        const note = notes[index]!;
        orderByNote.set(note, index);
        const relativeStartBeat = note.startBeat - midiOffsetBeats;
        // Membership mirrors the twin's wrap class on both sides of the head: a
        // start already before it re-anchors as-is, and a start up to one groove
        // stage after it can be displaced across by the clip groove — the twin
        // then re-anchors the displaced start to the iteration's late phase, so
        // the note must be a phase-index candidate for that window.
        if (relativeStartBeat >= MAX_GROOVE_STAGE_DISPLACEMENT_BEATS) {
            continue;
        }
        const phaseBeat = positiveModulo(relativeStartBeat, loopLengthBeats);
        const entry = { endPhaseBeat: phaseBeat + note.duration, note, phaseBeat };
        sortedEntries.push(entry);
        sortedEnds.push(entry);
        if (relativeStartBeat >= 0) {
            // The groove-crossing class sounds un-wrapped only while the groove
            // leaves the start on the head's near side; when it pulls the start
            // across, ownership re-anchors it a full loop later and the release
            // rings at `wrappedStart + duration`, past this entry's
            // `endPhaseBeat`. Index that wrapped release too: it lands within
            // one groove stage of `phaseBeat + loopLengthBeats + duration`,
            // exactly the slack the release window already spends, so the
            // window owning the wrapped release still finds the note here.
            sortedEnds.push({
                endPhaseBeat: phaseBeat + loopLengthBeats + note.duration,
                note,
                phaseBeat,
            });
        }
    }
    sortedEntries.sort(
        (left, right) => left.phaseBeat - right.phaseBeat || orderByNote.get(left.note)! - orderByNote.get(right.note)!
    );
    const created = {
        loopLengthBeats,
        midiOffsetBeats,
        orderByNote,
        sortedEnds: sortedEnds.sort((left, right) => left.endPhaseBeat - right.endPhaseBeat),
        sortedEntries,
    };
    yeastLoopPhaseIndexes.set(notes, created);
    return created;
}

function selectYeastNotesForSchedulerWindow({
    notes,
    iterationStartBeat,
    midiOffsetBeats,
    loopEnabled,
    loopLengthBeats,
    fromBeat,
    toBeat,
}: SelectYeastNotesForSchedulerWindowInput): readonly ScheduledMidiNote[] {
    const { maxDurationBeats, orderByNote, sortedNoteEnds, sortedNotes } = getScheduledMidiNoteIndex(notes);
    // #4655 — candidates live in content coordinates: the window's audible
    // span converts back with `+ midiOffsetBeats`, the same conversion
    // `selectMidiNotesForSchedulerWindow` performs. The boundary lookbehind
    // mirrors that selector too: content displaced before the iteration start
    // used to sound clamped to it, and only notes with `duration > offset −
    // content` survived the clamp, so `maxDurationBeats` covers every one of
    // them.
    const schedulesIterationBoundary = iterationStartBeat >= fromBeat && iterationStartBeat < toBeat;
    const leadingIntervalLookbehindBeats = schedulesIterationBoundary ? maxDurationBeats : 0;
    const sourceStartBeat =
        fromBeat -
        iterationStartBeat +
        midiOffsetBeats -
        MAX_GROOVE_STAGE_DISPLACEMENT_BEATS -
        leadingIntervalLookbehindBeats;
    const sourceEndBeat = toBeat - iterationStartBeat + midiOffsetBeats + MAX_GROOVE_STAGE_DISPLACEMENT_BEATS;
    const startIndex = lowerBoundMidiNoteStart(sortedNotes, sourceStartBeat);
    const endIndex = lowerBoundMidiNoteStart(sortedNotes, sourceEndBeat);
    const noteEndStartIndex = lowerBoundMidiNoteEnd(sortedNoteEnds, sourceStartBeat);
    const noteEndEndIndex = lowerBoundMidiNoteEnd(sortedNoteEnds, sourceEndBeat);
    const candidates = new Set<ScheduledMidiNote>();
    for (let index = startIndex; index < endIndex; index++) {
        candidates.add(sortedNotes[index]!);
    }
    for (let index = noteEndStartIndex; index < noteEndEndIndex; index++) {
        candidates.add(sortedNoteEnds[index]!);
    }
    if (loopEnabled && loopLengthBeats > 0) {
        // A looped iteration wraps a start displaced before its head into the
        // iteration — the twin's `((offset % loopLength) + loopLength) %
        // loopLength` re-anchor — so those notes are also selected by their
        // wrapped phase. Membership covers the groove too: a raw start within
        // `MAX_GROOVE_STAGE_DISPLACEMENT_BEATS` of the head is indexed on both
        // sides of it, and the phase window's own groove slack reaches the note
        // from the window that owns its displaced start. The window normalizes
        // into loop phase and may itself straddle the seam; the release query
        // stays unnormalized because a wrapped release rings past the iteration
        // end.
        const loopIndex = getYeastLoopPhaseIndex({ notes, loopLengthBeats, midiOffsetBeats });
        const phaseStartBeat = fromBeat - iterationStartBeat - MAX_GROOVE_STAGE_DISPLACEMENT_BEATS;
        const phaseEndBeat = toBeat - iterationStartBeat + MAX_GROOVE_STAGE_DISPLACEMENT_BEATS;
        const phaseWidthBeats = phaseEndBeat - phaseStartBeat;
        if (phaseWidthBeats >= loopLengthBeats) {
            for (const { note } of loopIndex.sortedEntries) {
                candidates.add(note);
            }
        } else {
            const normalizedStartBeat = positiveModulo(phaseStartBeat, loopLengthBeats);
            const normalizedEndBeat = normalizedStartBeat + phaseWidthBeats;
            const phaseStartIndex = lowerBoundYeastLoopPhase(loopIndex.sortedEntries, normalizedStartBeat);
            if (normalizedEndBeat <= loopLengthBeats) {
                const phaseEndIndex = lowerBoundYeastLoopPhase(loopIndex.sortedEntries, normalizedEndBeat);
                for (let index = phaseStartIndex; index < phaseEndIndex; index++) {
                    candidates.add(loopIndex.sortedEntries[index]!.note);
                }
            } else {
                const wrappedEndIndex = lowerBoundYeastLoopPhase(
                    loopIndex.sortedEntries,
                    normalizedEndBeat - loopLengthBeats
                );
                for (let index = phaseStartIndex; index < loopIndex.sortedEntries.length; index++) {
                    candidates.add(loopIndex.sortedEntries[index]!.note);
                }
                for (let index = 0; index < wrappedEndIndex; index++) {
                    candidates.add(loopIndex.sortedEntries[index]!.note);
                }
            }
        }
        const releaseStartIndex = lowerBoundYeastLoopEnd(loopIndex.sortedEnds, phaseStartBeat);
        const releaseEndIndex = lowerBoundYeastLoopEnd(loopIndex.sortedEnds, phaseEndBeat);
        for (let index = releaseStartIndex; index < releaseEndIndex; index++) {
            candidates.add(loopIndex.sortedEnds[index]!.note);
        }
    }
    return [...candidates].sort((left, right) => orderByNote.get(left)! - orderByNote.get(right)!);
}

function getScheduledIterationRange({
    clipStartBeat,
    fromBeat,
    iterationCount,
    loopEnabled,
    loopLengthBeats,
    toBeat,
}: GetScheduledIterationRangeInput): ScheduledIterationRange {
    if (!loopEnabled) {
        return { startIndex: 0, endIndex: Math.min(1, iterationCount) };
    }
    const startIndex = Math.max(0, Math.floor((fromBeat - clipStartBeat) / loopLengthBeats));
    const endIndex = Math.min(iterationCount, Math.ceil((toBeat - clipStartBeat) / loopLengthBeats));
    return { startIndex: Math.min(startIndex, endIndex), endIndex };
}

function getYeastCandidateIterationRange({
    clipStartBeat,
    fromBeat,
    iterationCount,
    loopEnabled,
    loopLengthBeats,
    midiOffsetBeats,
    toBeat,
    notes,
}: GetScheduledIterationRangeInput & {
    midiOffsetBeats: number;
    notes: readonly ScheduledMidiNote[];
}): ScheduledIterationRange {
    const activeRange = getScheduledIterationRange({
        clipStartBeat,
        fromBeat,
        iterationCount,
        loopEnabled,
        loopLengthBeats,
        toBeat,
    });
    if (!loopEnabled || notes.length === 0) {
        return activeRange;
    }
    const { maxDurationBeats, maxEndpointBeat } = getScheduledMidiNoteIndex(notes);
    // #4655 — endpoints are content beats; their audible position inside an
    // iteration is the offset-relative start, wrapped into the iteration when
    // it slips before the head. A looped iteration therefore owns note-ons up
    // to `max(loopLength, widest positive reach)` past its start, and a
    // wrapped note rings its release that far plus its duration, so the range
    // widens backwards by both and forwards only while the iteration start
    // still precedes the window.
    const latestOwnedOffsetBeats = Math.max(loopLengthBeats, maxEndpointBeat - midiOffsetBeats);
    const firstEndpointIndex = Math.max(
        0,
        Math.ceil(
            (fromBeat -
                MAX_GROOVE_STAGE_DISPLACEMENT_BEATS -
                clipStartBeat -
                latestOwnedOffsetBeats -
                maxDurationBeats) /
                loopLengthBeats
        )
    );
    const endpointEndIndex = Math.min(
        iterationCount,
        Math.floor((toBeat + MAX_GROOVE_STAGE_DISPLACEMENT_BEATS - clipStartBeat) / loopLengthBeats) + 1
    );
    return {
        startIndex: Math.min(activeRange.startIndex, firstEndpointIndex),
        endIndex: Math.max(activeRange.endIndex, endpointEndIndex),
    };
}

/**
 * The built-in synth's MPE params for a scheduled note, or `undefined` when the
 * note carries no expression at all.
 *
 * The bend range rides along only when there is a bend to interpret. A range on
 * a note that never bent describes nothing, the synth never reads it, and
 * emitting it anyway makes every exact-shape assertion downstream pin a
 * fallback instead of a decision (audit MD-8).
 */
function clampOptional(value: number | undefined, min: number, max: number): number | undefined {
    return value === undefined ? undefined : Math.min(max, Math.max(min, value));
}

function resolveScheduledMpeParams(note: ScheduledMpeParams): ScheduledMpeParams | undefined {
    const hasExpression = note.pressure !== undefined || note.slide !== undefined || note.pitchBend !== undefined;
    if (!hasExpression) {
        return undefined;
    }

    const params: ScheduledMpeParams = {
        pressure: clampOptional(note.pressure, 0, MAX_MIDI_DATA_7BIT),
        slide: clampOptional(note.slide, 0, MAX_MIDI_DATA_7BIT),
        pitchBend: clampOptional(note.pitchBend, PITCH_BEND_MIN, PITCH_BEND_MAX),
    };
    if (note.pitchBend !== undefined) {
        params.pitchBendRangeSemitones = clampOptional(
            note.pitchBendRangeSemitones ?? getDefaultBendRangeSemitones(),
            0,
            127
        );
    }
    return params;
}

type PlaceSamplesOnClockInput = {
    startSamples: number;
    accumulatedSamples: number;
    sampleRate: number;
    compensation: number;
};

/**
 * The audio-clock time and sample frame an event `startSamples` into the
 * timeline is posted at. Notes and stored controllers both place themselves
 * through this, so a controller and a note on one beat get the same frame.
 */
function placeSamplesOnClock({
    startSamples,
    accumulatedSamples,
    sampleRate,
    compensation,
}: PlaceSamplesOnClockInput): { time: number; sampleFrame: number } {
    const time = getCurrentTime() + (startSamples - accumulatedSamples) / sampleRate + compensation;
    return { time, sampleFrame: Math.round(time * sampleRate) };
}

function getSourceOccurrenceOffset({
    sourceStartBeat,
    segmentStartBeat,
    loopLength,
    loopEnabled,
}: GetSourceOccurrenceOffsetInput): number {
    if (!loopEnabled || loopLength <= 0) {
        return 0;
    }

    const beatsFromSourceStart = segmentStartBeat - sourceStartBeat;
    if (beatsFromSourceStart <= 0) {
        return 0;
    }

    return Math.floor(beatsFromSourceStart / loopLength);
}

/**
 * Emit every MIDI event whose start beat falls in the half-open window
 * `[fromBeat, toBeat)`.
 *
 * `fromBeat` is the scheduler's monotonic high-water mark: the transport passes
 * `schedulerSession.lastScheduledBeat`, which is exactly where the previous
 * window ended, so a note already emitted can never be emitted twice.
 *
 * `opensAtRelocation` marks a window whose `fromBeat` is where already-rolling
 * playback was just relocated to (a loop wrap, a follow-action jump), not the
 * continuation of the previous window. It additionally restores every stored
 * controller to the value in force at `fromBeat` and lifts those left engaged
 * that nothing is in force for there, at the frame `fromBeat` lands on. A
 * transport start or a user seek is not a relocation in this sense. A track that
 * schedules again after a track or clip mute withheld its stored controllers gets
 * the same restore in that window.
 */
export async function scheduleMidiNotes(
    fromBeat: number,
    toBeat: number,
    accumulatedPosition: number,
    scheduledFrozenTracks: Set<string>,
    activeAudioSources: AudioBufferSourceNode[],
    transport: TransportState,
    currentTempo: number,
    cancellation?: SchedulerCancellation,
    opensAtRelocation = false
): Promise<void> {
    const isCurrent = cancellation?.isCurrent ?? (() => true);
    const tracks = trackStore.value?.tracks;
    const midiState = midiStore.value;
    if (!tracks || !midiState) {
        return;
    }

    // The frozen path's window floor (#4784) binds on the same emissions the
    // audio-clip twin's does — a wrap handover or a landing, where the window
    // opens at a boundary the playhead stands at or behind — never on a
    // steady-state window, whose first beat sits a look-ahead ahead of the
    // playhead and would hold a late join silent. A frozen track first becoming
    // schedulable mid-handover floors too: the playhead sits below loopStart
    // while a seam is pending or just recorded.
    const floorsToWindowStart =
        fromBeat <= accumulatedPosition ||
        (transport.isLooping === true && fromBeat === transport.loopStart) ||
        (transport.isLooping === true &&
            accumulatedPosition < transport.loopStart &&
            (schedulerSession.pendingSeam !== null || schedulerSession.lastLoopSeamAudioTime !== null));
    const changes = tempoMapStore.value?.changes ?? [];
    const automationLanes = automationStore.value?.lanes ?? [];
    // #4924 — the earliest start an admitted Yeast segment may still schedule
    // (the gate below). A wrap re-anchors a duration tail to the iteration head
    // at its note's own loop phase — arbitrarily close behind the owning window
    // — so staleness is a clock question, not a window-grace question:
    // `accumulatedPosition` is the beat `getCurrentTime()` stands for this tick
    // (the same position the note time formula measures against), and a start
    // behind it computes a time in the past that Web Audio clamps to an
    // immediate fire. The window's groove-reach bound stays as the floor for
    // clocks trailing the window by more than one groove stage, where it still
    // drops the far-behind wraps. `BEAT_EPSILON` absorbs the wrap re-anchor's
    // modulo round-trip noise — ulp-scale, orders below any musical distance —
    // so a landing at the clock reads as due, not stale.
    const admittedSegmentFloorBeat =
        Math.max(fromBeat - MAX_GROOVE_STAGE_DISPLACEMENT_BEATS, accumulatedPosition) - BEAT_EPSILON;
    // #4591 — the MIDI twin of scheduleAudioClips' cue-send rule: the strip's
    // mute sits downstream of the pre-fader tap, so a muted MIDI track still
    // feeds its pre-fader (cue) sends, and the offline mixdown schedules those
    // tracks (`resolveOfflineMixAudibility`). Skipping every muted track here
    // left its bus silent live while the export played the return. A
    // post-fader send dies with the mute and a send to a bus that no longer
    // exists reaches nothing, so both stay skipped, as the audio twin skips
    // them.
    const busTrackIds = new Set(
        tracks.filter((candidate) => candidate.kind === 'bus').map((candidate) => candidate.id)
    );
    // The devices a relocating window restored, so the sweep after the tracks
    // lifts only what no track restored.
    const restoredStoredControllerDevices = new Set<string>();
    // The sample frame a beat is posted at on one track's clock, for the window's own moves and for
    // a relocation's restore alike.
    const sampleFrameAtBeatOnTrack = (trackId: string) => (beat: number) => {
        const { sampleRate } = getAudioContext();
        return placeSamplesOnClock({
            startSamples: beatToSamples(changes, beat, transport.tempo, sampleRate),
            accumulatedSamples: beatToSamples(changes, accumulatedPosition, transport.tempo, sampleRate),
            sampleRate,
            compensation: getCompensationDelay(trackId),
        }).sampleFrame;
    };
    // What a relocation's restore sends for one track's routed device, from every clip of the track:
    // a destination inside a clip and one across a gap run the same restore.
    const restoreStoredControllersOnTrack = (
        track: SchedulerTrack,
        target: NonNullable<ReturnType<typeof resolveStoredControllerDevice>>,
        queue: ReturnType<typeof createSameFramePostQueue>
    ): void => {
        restoreStoredControllers({
            trackId: track.id,
            device: target.device,
            node: target.node,
            clips: resolveStoredControllerClips({
                trackId: track.id,
                clips: track.clips,
                notesByClipId: midiState.notesByClipId,
                ccByClipId: midiState.ccByClipId,
            }),
            atBeat: fromBeat,
            windowToBeat: toBeat,
            sampleFrameAtBeat: sampleFrameAtBeatOnTrack(track.id),
            queue,
        });
        restoredStoredControllerDevices.add(storedControllerDeviceKey(track.id, target.device.id));
    };
    // A relocation that lands where a track has no clip playing still carries what its earlier clips
    // left, as continuous playback does, on the device the window would route stored controllers to; a
    // posted device the scheduler no longer routes to is left to the release sweep. A track resuming
    // after a mute is owed the same restore wherever it resumes.
    const restoreStoredControllersAtGap = (track: SchedulerTrack, resumesAfterMute: boolean): void => {
        const target = opensAtRelocation || resumesAfterMute ? resolveStoredControllerDevice(track, tracks) : null;
        if (!target) {
            return;
        }
        const queue = createSameFramePostQueue();
        restoreStoredControllersOnTrack(track, target, queue);
        queue.flush(isCurrent);
    };
    // Whether this window is the one a track schedules again in after a mute kept its stored controllers
    // from earlier windows of this playback: the device still holds what it last received, so the window
    // restores the value in force at its start, the chase a relocation runs. A track mute ends here
    // whatever muted clips overlap the window, because the restore leaves muted clips out. A clip mute ends
    // for each recorded clip on its own, in the first window that clip no longer withholds (unmuted, ended,
    // moved away or removed), whatever other clips stay muted. A record is forgotten as the window decides,
    // because the restore it queues is the chase that mute owed.
    const withholdsStoredControllers = (mutedClip: SchedulerTrack['clips'][number]): boolean =>
        mutedClip.startBeat < toBeat &&
        mutedClip.endBeat > fromBeat &&
        (midiState.ccByClipId[mutedClip.id]?.length ?? 0) > 0;
    const stillWithholds = (mutedClips: readonly SchedulerTrack['clips'][number][], clipId: string): boolean => {
        for (const mutedClip of mutedClips) {
            if (mutedClip.id === clipId) {
                return withholdsStoredControllers(mutedClip);
            }
        }
        return false;
    };
    const takeResumeAfterMute = (track: SchedulerTrack): boolean => {
        const mutedClips = listMutedMidiClips(track.clips);
        let resumes = hasStoredControllersTrackMuteWithheld(track.id);
        if (resumes) {
            forgetStoredControllersTrackMuteWithheld(track.id);
        }
        const withheldClipIds = readStoredControllersClipMuteWithheld(track.id);
        if (withheldClipIds) {
            for (const clipId of withheldClipIds) {
                if (!stillWithholds(mutedClips, clipId)) {
                    forgetStoredControllersClipMuteWithheld(track.id, clipId);
                    resumes = true;
                }
            }
        }
        for (const mutedClip of mutedClips) {
            if (withholdsStoredControllers(mutedClip)) {
                noteStoredControllersClipMuteWithheld(track.id, mutedClip.id);
            }
        }
        return resumes;
    };
    for (const track of tracks) {
        if (!isCurrent()) {
            return;
        }
        if (track.kind !== 'midi') {
            continue;
        }
        if (track.muted && !track.sends.some((send) => send.preFader && busTrackIds.has(send.busId))) {
            noteStoredControllersTrackMuteWithheld(track.id);
            continue;
        }

        if (track.freezeState.status === 'frozen' && track.freezeState.frozenBufferId) {
            // Dedup per session (same contract as scheduleAudioClips): the
            // whole frozen buffer is scheduled in a single shot anchored to the
            // absolute start time, so without the guard every 10 ms tick would
            // layer another copy of the track on top of the previous ones.
            // The key includes the frozenBufferId so an unfreeze → refreeze
            // (same track.id, new buffer) invalidates the dedup entry and the
            // refrozen render is scheduled instead of staying silent for the
            // rest of the session.
            const frozenKey = `${track.id}:${track.freezeState.frozenBufferId}`;
            if (!scheduledFrozenTracks.has(frozenKey)) {
                const scheduled = scheduleFrozenTrack(
                    track,
                    accumulatedPosition,
                    activeAudioSources,
                    currentTempo,
                    floorsToWindowStart ? fromBeat : null
                );
                if (scheduled) {
                    scheduledFrozenTracks.add(frozenKey);
                }
            }
            continue;
        }

        const resumesAfterMute = takeResumeAfterMute(track);
        const windowMidiClips = selectMidiClipsForSchedulerWindow({ clips: track.clips, fromBeat, toBeat });
        if (windowMidiClips.length === 0) {
            restoreStoredControllersAtGap(track, resumesAfterMute);
            continue;
        }

        const resolvedClips = resolveClipsWithComping(track.id, windowMidiClips);
        const activeMidiClips = resolvedClips.filter(
            (clip) => !clip.muted && clip.type === 'midi' && clip.endBeat > fromBeat && clip.startBeat < toBeat
        );
        if (activeMidiClips.length === 0) {
            restoreStoredControllersAtGap(track, resumesAfterMute);
            continue;
        }

        const drumKitDef = resolveDrumKitDef(track.devices);
        const drumKit = drumKitDef ? null : resolveDrumKit(track.devices);
        const withheldNoteVoicingDevice = findWithheldNoteVoicingDevice(track, tracks);
        const yeastDevice = track.devices.find((device) => device.type === 'yeast');
        const liveYeastIterations: LiveYeastIteration[] = [];
        let activeYeastCarrierRouteId: string | undefined;

        if (yeastDevice) {
            for (const clip of activeMidiClips) {
                const sourceNotes = midiState.notesByClipId[clip.id];
                if (!sourceNotes) {
                    continue;
                }

                const clipVisualLength = clip.endBeat - clip.startBeat;
                const loopProjection = projectClipLoopExpansion({
                    clipDurationBeats: clipVisualLength,
                    configuredLoopLengthBeats: clip.loopLength,
                    loopEnabled: clip.loopEnabled ?? false,
                });
                const loopLength = loopProjection.loopLengthBeats;
                const sourceOccurrenceOffset = getSourceOccurrenceOffset({
                    sourceStartBeat: clip.sourceStartBeat,
                    segmentStartBeat: clip.startBeat,
                    loopLength,
                    loopEnabled: clip.loopEnabled ?? false,
                });
                const iterationCount = loopProjection.iterationCount;
                const activeIterationRange = getScheduledIterationRange({
                    clipStartBeat: clip.startBeat,
                    fromBeat,
                    iterationCount,
                    loopEnabled: clip.loopEnabled ?? false,
                    loopLengthBeats: loopLength,
                    toBeat,
                });
                const candidateIterationRange = getYeastCandidateIterationRange({
                    clipStartBeat: clip.startBeat,
                    fromBeat,
                    iterationCount,
                    loopEnabled: clip.loopEnabled ?? false,
                    loopLengthBeats: loopLength,
                    midiOffsetBeats: clip.midiOffsetBeats ?? 0,
                    notes: sourceNotes,
                    toBeat,
                });
                for (
                    let iteration = candidateIterationRange.startIndex;
                    iteration < candidateIterationRange.endIndex;
                    iteration++
                ) {
                    if (!isCurrent()) {
                        return;
                    }
                    const absoluteOccurrenceIndex = sourceOccurrenceOffset + iteration;
                    const iterationStartBeat = clip.startBeat + iteration * loopLength;
                    const iterationEndBeat = Math.min(iterationStartBeat + loopLength, clip.endBeat);
                    const routeId = `live-yeast:${track.id}:${clip.id}:${absoluteOccurrenceIndex}`;
                    const candidateNotes = selectYeastNotesForSchedulerWindow({
                        notes: sourceNotes,
                        iterationStartBeat,
                        midiOffsetBeats: clip.midiOffsetBeats ?? 0,
                        loopEnabled: clip.loopEnabled ?? false,
                        loopLengthBeats: loopLength,
                        fromBeat,
                        toBeat,
                    });
                    const isActiveIteration =
                        iteration >= activeIterationRange.startIndex && iteration < activeIterationRange.endIndex;
                    if (!isActiveIteration && candidateNotes.length === 0) {
                        continue;
                    }
                    const iterationDescriptor = {
                        routeId,
                        clipId: clip.id,
                        iterationStartBeat,
                        iterationEndBeat,
                        midiOffsetBeats: clip.midiOffsetBeats ?? 0,
                        loopEnabled: clip.loopEnabled ?? false,
                        loopLengthBeats: loopLength,
                        sourceNotes,
                    } satisfies LiveYeastIteration;
                    cancellation?.yeastRouteLineage.set(routeId, iterationDescriptor);
                    liveYeastIterations.push({
                        ...iterationDescriptor,
                        sourceNotes: candidateNotes.filter((note) =>
                            shouldPlayMidiEvent({
                                projectProbabilitySeed: midiState.probabilitySeed,
                                clipId: clip.id,
                                eventId: note.id,
                                absoluteOccurrenceIndex,
                                probabilityPercent: note.probability ?? 100,
                            })
                        ),
                    });
                    if (activeYeastCarrierRouteId === undefined && isActiveIteration) {
                        activeYeastCarrierRouteId = routeId;
                    }
                }
            }
        }

        const liveYeastNotesByRoute = new Map<string, LiveYeastNote[]>();
        const trackScopedYeastNoteIds = new Set<string>();
        if (yeastDevice && activeYeastCarrierRouteId !== undefined) {
            const yeastResult = await processLiveYeastTrackBlock({
                context: getAudioContext(),
                rackId: yeastDevice.id,
                trackId: track.id,
                iterations: liveYeastIterations,
                fromBeat,
                toBeat,
                changes,
                timeSignatureChanges: timeSignatureMapStore.value?.changes ?? [],
                transport,
                discontinuityEpoch: cancellation?.discontinuityEpoch,
                isCurrent,
                routeLineage: cancellation?.yeastRouteLineage,
            });
            if (!yeastResult) {
                return;
            }
            for (const [routeId, routeNotes] of yeastResult.notesByRoute) {
                liveYeastNotesByRoute.set(routeId, routeNotes);
            }
            if (yeastResult.generatedNotes.length > 0) {
                for (const note of yeastResult.generatedNotes) {
                    const hasOriginCarrier = liveYeastIterations.some(
                        (iteration) =>
                            iteration.iterationStartBeat <= note.startBeat &&
                            note.startBeat < iteration.iterationEndBeat
                    );
                    if (!hasOriginCarrier) {
                        continue;
                    }
                    const [projectedNote] = projectCommittedGroove({
                        events: [note],
                        consumerType: 'sequencer',
                        consumerId: 'project',
                    });
                    const carrierIteration = liveYeastIterations.find(
                        (iteration) =>
                            projectedNote &&
                            iteration.iterationStartBeat <= projectedNote.startBeat &&
                            projectedNote.startBeat < iteration.iterationEndBeat
                    );
                    if (!projectedNote || !carrierIteration) {
                        continue;
                    }
                    const carrierNotes = liveYeastNotesByRoute.get(carrierIteration.routeId) ?? [];
                    carrierNotes.push(projectedNote);
                    liveYeastNotesByRoute.set(carrierIteration.routeId, carrierNotes);
                    trackScopedYeastNoteIds.add(projectedNote.id);
                }
            }
        }

        // Every clip of this track posts through one queue, so the order a
        // frame's events reach the instrument does not depend on the clip order.
        const posts = createSameFramePostQueue();
        const storedControllerTarget = resolveStoredControllerDevice(track, tracks);
        for (const clip of activeMidiClips) {
            const notes = midiState.notesByClipId[clip.id];
            if (!notes) {
                continue;
            }

            const clipMidiOffset = clip.midiOffsetBeats ?? 0;
            const synthParams =
                drumKit || drumKitDef || withheldNoteVoicingDevice ? null : getSynthParamsForTrack(track.id);
            const compensation = getCompensationDelay(track.id);
            const clipVisualLength = clip.endBeat - clip.startBeat;
            const loopProjection = projectClipLoopExpansion({
                clipDurationBeats: clipVisualLength,
                configuredLoopLengthBeats: clip.loopLength,
                loopEnabled: clip.loopEnabled ?? false,
            });
            const loopLen = loopProjection.loopLengthBeats;
            const maxIterations = loopProjection.iterationCount;
            const scheduledIterationRange = getScheduledIterationRange({
                clipStartBeat: clip.startBeat,
                fromBeat,
                iterationCount: maxIterations,
                loopEnabled: clip.loopEnabled ?? false,
                loopLengthBeats: loopLen,
                toBeat,
            });
            const sourceOccurrenceOffset = getSourceOccurrenceOffset({
                sourceStartBeat: clip.sourceStartBeat,
                segmentStartBeat: clip.startBeat,
                loopLength: loopLen,
                loopEnabled: clip.loopEnabled ?? false,
            });
            const strip = ensureTrackStrip(track.id);
            const ctx = getAudioContext();
            const sr = ctx.sampleRate;

            // §154.2 — Hoist parent-track + sibling-pad resolution out of the
            // per-note loop. These are functions of (track, tracks) only and
            // never change while we iterate notes.
            // §154.3 — Pre-resolve the per-track dispatch decision so the
            // note loop is a single switch instead of 4+ device array scans
            // per note (drumKitDef | drumKit | toasterChild | workletSynth |
            // faust | default synth).
            const toasterTarget = resolveToasterTarget(track, tracks, strip);
            const toasterRoute = toasterTarget
                ? {
                      controls: toasterTarget.controls,
                      pad: toasterTarget.pad,
                      getSwingOffsetBeats: (noteStartBeat: number) =>
                          getToasterSwingOffsetBeats({
                              parentTrackId: toasterTarget.ownerTrack.id,
                              toasterDeviceId: toasterTarget.device.id,
                              automationMode: toasterTarget.ownerTrack.automationMode,
                              devices: toasterTarget.ownerTrack.devices,
                              lanes: automationLanes,
                              noteStartBeat,
                              evaluateAutomationValue: getAutomationValueAtBeat,
                              isAutomationRecording: isRecordingAutomation,
                              getCurrentSwingValue: (deviceId) =>
                                  toasterStore.value?.[deviceId]?.kit.swing ??
                                  toasterTarget.device.parameterValues.swing ??
                                  0,
                          }),
                  }
                : null;

            const workletSynthDevice = toasterRoute ? null : findWorkletSynthDevice(track.devices);
            const workletSynthEntry = workletSynthDevice
                ? (WORKLET_SYNTH_DEVICES[workletSynthDevice.type] ?? null)
                : null;
            const workletSynthNode = workletSynthDevice
                ? (strip.deviceNodes.find((data) => data.deviceId === workletSynthDevice.id) ?? null)
                : null;
            const workletSynthControls =
                workletSynthEntry && workletSynthNode
                    ? (workletSynthNode[workletSynthEntry.controlsKey] ?? null)
                    : null;

            // The `faust-` prefix is carried by every Faust module, effect or
            // instrument, so matching it took a MIDI track's notes into the
            // first Faust *effect* in the rack — freq/gain/gate written into a
            // reverb voice nothing. Because the branch below is an `else if`,
            // taking it also skipped the builtin-synth fallback, so such a
            // track was silent live while the export rendered the fallback:
            // offline picks its note target from `instrumentControls`, which
            // `buildDeviceChain` only attaches when the strategy declares
            // `acceptsNotes` — and `FaustDeviceStrategy` takes that from
            // `isFaustInstrumentModule`. Asking the same question here is what
            // keeps the two runtimes on the same device.
            const faustDevice =
                toasterRoute || drumKitDef || drumKit || workletSynthControls
                    ? null
                    : findFaustInstrumentDevice(track.devices);

            // Stored controllers join the window's queue, which posts them ahead
            // of the note-ons of their frame (so a note struck there sounds under
            // the pedal or controller it was recorded with) and behind the
            // note-offs (so a pedal does not catch a note released there). Only
            // the instruments that honour them take any, and only through the
            // note path's own dispatch: a Yeast-routed, drum-kit or Toaster track
            // sends its notes elsewhere and its controllers nowhere.
            const storedControllers = storedControllerTarget ? midiState.ccByClipId[clip.id] : undefined;
            if (storedControllerTarget && storedControllers) {
                scheduleStoredControllers({
                    trackId: track.id,
                    device: storedControllerTarget.device,
                    node: storedControllerTarget.node,
                    controlChanges: storedControllers,
                    clip,
                    fromBeat,
                    toBeat,
                    sampleFrameAtBeat: sampleFrameAtBeatOnTrack(track.id),
                    queue: posts,
                });
            }

            for (let iter = scheduledIterationRange.startIndex; iter < scheduledIterationRange.endIndex; iter++) {
                if (!isCurrent()) {
                    return;
                }
                const absoluteOccurrenceIndex = sourceOccurrenceOffset + iter;
                const iterOffset = iter * loopLen;
                const yeastRouteId = `live-yeast:${track.id}:${clip.id}:${absoluteOccurrenceIndex}`;
                let iterNotes: readonly LiveYeastNote[];
                if (yeastDevice) {
                    iterNotes = liveYeastNotesByRoute.get(yeastRouteId) ?? [];
                } else if (clip.loopEnabled) {
                    iterNotes = selectMidiNotesForLoopWindow({
                        notes,
                        iterationStartBeat: clip.startBeat + iterOffset,
                        loopLengthBeats: loopLen,
                        midiOffsetBeats: clipMidiOffset,
                        fromBeat,
                        toBeat,
                        // The window start IS the high-water mark here; the loop
                        // selector keeps the two separate for its own callers.
                        lastScheduledBeat: fromBeat,
                        grooveLookaroundBeats: MIDI_NOTE_GROOVE_LOOKAROUND_BEATS,
                    });
                } else {
                    iterNotes = selectMidiNotesForSchedulerWindow({
                        notes,
                        iterationStartBeat: clip.startBeat + iterOffset,
                        midiOffsetBeats: clipMidiOffset,
                        fromBeat,
                        toBeat,
                    });
                }
                const notesAreAbsolute = yeastDevice !== undefined;

                for (const note of iterNotes) {
                    if (!isCurrent()) {
                        return;
                    }
                    const isTrackScopedYeastNote = trackScopedYeastNoteIds.has(note.id);
                    if (!notesAreAbsolute && note.startBeat - clipMidiOffset >= loopLen) {
                        continue;
                    }
                    // #4910 — a live Yeast source note is owned once, by
                    // processLiveYeastTrackBlock's block windows, at its audible
                    // beat before the sequencer groove displaces it. Re-testing
                    // the projected start dropped notes ownership had already
                    // admitted whenever the displacement crossed a window edge —
                    // or a looped iteration head, which the projection re-anchors
                    // a full loop away — so this population is admitted on the
                    // owned coordinate and the displaced start schedules where it
                    // lands, the same post-admission treatment swing gets. Every
                    // other path's selector only pre-selects groove-slack
                    // candidates; the projected-start test is their real
                    // ownership and keeps the exact window semantics.
                    const admittedOnOwnedBeat = notesAreAbsolute && !isTrackScopedYeastNote;
                    if (admittedOnOwnedBeat && (note.startBeat < fromBeat || note.startBeat >= toBeat)) {
                        continue;
                    }

                    const iterationStart = clip.startBeat + iterOffset;
                    let projectedNotes: readonly LiveYeastNote[];
                    if (isTrackScopedYeastNote) {
                        projectedNotes = [note];
                    } else {
                        projectedNotes = projectClipMidiEvents({
                            events: [note],
                            clipId: clip.id,
                            clipStartBeat: clip.startBeat,
                            clipEndBeat: clip.endBeat,
                            iterationStartBeat: iterationStart,
                            loopLengthBeats: loopLen,
                            midiOffsetBeats: clipMidiOffset,
                            loopEnabled: clip.loopEnabled ?? false,
                            clipGrooveAlreadyApplied: notesAreAbsolute,
                            eventsAreAbsolute: notesAreAbsolute,
                        });
                    }

                    for (const projectedNote of projectedNotes) {
                        const unswungStartBeat = projectedNote.startBeat;
                        // #4910 admitted the note on its owned coordinate, so its
                        // segments schedule where the projection lands them — a
                        // groove displacement past `toBeat` included. What they may
                        // never do is start before the audio clock: the wrap lands
                        // a tail behind the owning window at its note's loop phase
                        // — arbitrarily small — so `admittedSegmentFloorBeat` gates
                        // on the clock position instead of a window grace, and the
                        // drop is strict beyond its rounding tolerance: a landing
                        // on the clock computes `getCurrentTime()`, the onset's own
                        // due instant, and still schedules (#4924). Swing only
                        // delays a start, so the unswung coordinate is the safe
                        // comparison.
                        if (admittedOnOwnedBeat) {
                            if (unswungStartBeat < admittedSegmentFloorBeat) {
                                continue;
                            }
                        } else if (unswungStartBeat < fromBeat || unswungStartBeat >= toBeat) {
                            continue;
                        }
                        if (!isCurrent()) {
                            return;
                        }
                        if (!yeastDevice) {
                            const shouldPlay = shouldPlayMidiEvent({
                                projectProbabilitySeed: midiState.probabilitySeed,
                                clipId: clip.id,
                                eventId: note.id,
                                absoluteOccurrenceIndex,
                                probabilityPercent: note.probability ?? 100,
                            });
                            if (!shouldPlay) {
                                continue;
                            }
                        }

                        const swingOffsetBeats = toasterRoute?.getSwingOffsetBeats(unswungStartBeat) ?? 0;
                        const noteStartBeat = unswungStartBeat + swingOffsetBeats;
                        let pitch = note.pitch;
                        if (track.followChordTrack && !drumKitDef && !drumKit && !toasterRoute) {
                            const refChord = getChordAtBeat(clip.startBeat);
                            const targetChord = getChordAtBeat(noteStartBeat);
                            pitch = transposeForChordTrack(pitch, refChord, targetChord);
                        }

                        const iterationEndBeat = Math.min(iterationStart + loopLen, clip.endBeat);
                        const unswungEndBeat = isTrackScopedYeastNote
                            ? Math.min(unswungStartBeat + projectedNote.duration, iterationEndBeat)
                            : unswungStartBeat + projectedNote.duration;
                        const noteEndBeat = unswungEndBeat + swingOffsetBeats;
                        const noteStartSamples = beatToSamples(changes, noteStartBeat, transport.tempo, sr);
                        const noteEndSamples = beatToSamples(changes, noteEndBeat, transport.tempo, sr);
                        const accumulatedSamples = beatToSamples(changes, accumulatedPosition, transport.tempo, sr);
                        const { time, sampleFrame } = placeSamplesOnClock({
                            startSamples: noteStartSamples,
                            accumulatedSamples,
                            sampleRate: sr,
                            compensation,
                        });
                        const durationSamples = noteEndSamples - noteStartSamples;
                        const duration = durationSamples / sr;
                        // The release is placed on the clock exactly as the start
                        // and a stored controller are, not as the start frame plus
                        // a length: rounding the start and adding the length can
                        // land a frame away from rounding the end, and a pedal on
                        // the beat a note ends would then miss its own release.
                        const endSampleFrame = placeSamplesOnClock({
                            startSamples: noteEndSamples,
                            accumulatedSamples,
                            sampleRate: sr,
                            compensation,
                        }).sampleFrame;
                        const noteGain = isTrackScopedYeastNote ? 1 : clip.gain;

                        if (toasterRoute) {
                            const pad = toasterRoute.pad >= 0 ? toasterRoute.pad : resolveToasterPadIndex(pitch);
                            if (pad !== null) {
                                const safeVelocity = projectedNote.velocity;
                                toasterRoute.controls.noteOn(pad, safeVelocity, TOASTER_NEUTRAL_MIDI_NOTE, sampleFrame);
                            }
                        } else if (drumKitDef) {
                            scheduleDrumKitNote(
                                ctx,
                                strip.gainNode,
                                drumKitDef,
                                pitch,
                                time,
                                projectedNote.velocity,
                                noteGain
                            );
                        } else if (drumKit) {
                            const kitVoice = scheduleKitNote(
                                ctx,
                                strip.gainNode,
                                drumKit,
                                pitch,
                                time,
                                duration,
                                projectedNote.velocity,
                                noteGain
                            );
                            if (kitVoice) {
                                registerScheduledSource(kitVoice);
                            }
                        } else if (workletSynthControls && workletSynthEntry) {
                            // A note of no samples is not played, as the export skips a
                            // note of no duration. Posting it would put its release on
                            // its own start frame, where it would cut a different note
                            // of the same pitch struck there; the sliver a looped
                            // clip's pass wrap re-anchors onto a pass head is the usual
                            // case. Only this path is skipped: its release is a message
                            // that can collide, while a built-in synth voice or a drum
                            // hit of no length has nothing to cut.
                            if (durationSamples <= 0) {
                                continue;
                            }
                            const rawVel = projectedNote.velocity;
                            const vel = workletSynthEntry.velocityTransform
                                ? workletSynthEntry.velocityTransform(rawVel)
                                : rawVel;
                            const noteChannel = note.channel ?? 0;
                            const articulationId = workletSynthDevice
                                ? resolveMidiNoteArticulationId({
                                      deviceType: workletSynthDevice.type,
                                      articulation: projectedNote.articulation,
                                  })
                                : null;
                            // The note's posts wait for the window's queue: a
                            // frame's events must reach the engine release,
                            // controller, note-on, expression whichever clip or
                            // window the note came from.
                            if (workletSynthDevice?.type === 'levain' && workletSynthNode?.levainControls) {
                                const levainControls = workletSynthNode.levainControls;
                                posts.add('on', sampleFrame, () =>
                                    levainControls.noteOn(
                                        pitch,
                                        vel,
                                        sampleFrame,
                                        noteChannel,
                                        articulationId ?? undefined
                                    )
                                );
                            } else {
                                posts.add('on', sampleFrame, () =>
                                    workletSynthControls.noteOn(pitch, vel, sampleFrame, noteChannel)
                                );
                            }
                            // The depth the bend was recorded at, and only when
                            // there is a bend. Absent on notes captured before
                            // RPN 0 was decoded, which resolves to the MPE
                            // member default — the range they were actually
                            // performed under (audit MD-8).
                            const mpe = resolveScheduledMpeParams(note);
                            const noteBendRange = mpe?.pitchBendRangeSemitones;
                            // MPE per-note expression (audit MD-2). Same
                            // surface the live Web MIDI handlers call, at the
                            // note's own start frame so the worklet applies it
                            // to the voice this noteOn just started.
                            posts.add('expression', sampleFrame, () =>
                                applyNoteExpression({
                                    trackId: track.id,
                                    note: pitch,
                                    channel: noteChannel,
                                    expression: {
                                        pressure: mpe?.pressure,
                                        slide: mpe?.slide,
                                        pitchBend: mpe?.pitchBend,
                                    },
                                    sampleFrame,
                                    bendRangeSemitones: noteBendRange,
                                })
                            );
                            // Grand Boule is the one worklet synth whose
                            // `noteOff` reads a release velocity in slot 3 and
                            // its member channel in slot 4; Fermenter, Levain
                            // and Crumbs take the channel in slot 3. The shared
                            // three-argument call put the channel index where
                            // the release dynamic goes and left the release
                            // unaddressed, so it silenced every voice at that
                            // pitch instead of the one held on that channel.
                            // All four control types accept three numbers, so
                            // the compiler had nothing to object to.
                            if (workletSynthDevice?.type === 'grand-boule' && workletSynthNode?.grandBouleControls) {
                                const grandBouleControls = workletSynthNode.grandBouleControls;
                                posts.add('off', endSampleFrame, () =>
                                    grandBouleControls.noteOff(pitch, endSampleFrame, undefined, noteChannel)
                                );
                            } else {
                                posts.add('off', endSampleFrame, () =>
                                    workletSynthControls.noteOff(pitch, endSampleFrame, noteChannel)
                                );
                            }
                        } else if (faustDevice) {
                            scheduleFaustNote(
                                track.id,
                                faustDevice.id,
                                pitch,
                                time,
                                duration,
                                projectedNote.velocity,
                                noteGain
                            );
                        } else if (!withheldNoteVoicingDevice) {
                            // The built-in synth holds no range of its own; it
                            // bends by the depth the note was recorded at
                            // (audit MD-8).
                            const mpe = resolveScheduledMpeParams(note);
                            const synthVoice = scheduleNote(
                                ctx,
                                strip.gainNode,
                                pitch,
                                time,
                                duration,
                                projectedNote.velocity,
                                synthParams!,
                                mpe,
                                noteGain
                            );
                            // Built-in synth and kit voices are bare
                            // oscillators; nothing else holds their handle, so
                            // without this a stop or a panic leaves them ringing
                            // for the rest of their programmed duration (MD-6).
                            registerScheduledSource(synthVoice);
                        }
                    }
                }
            }
        }
        if ((opensAtRelocation || resumesAfterMute) && storedControllerTarget) {
            restoreStoredControllersOnTrack(track, storedControllerTarget, posts);
        }
        posts.flush(isCurrent);
    }
    if (opensAtRelocation && isCurrent()) {
        const { sampleRate } = getAudioContext();
        const accumulatedSamples = beatToSamples(changes, accumulatedPosition, transport.tempo, sampleRate);
        const destinationSamples = beatToSamples(changes, fromBeat, transport.tempo, sampleRate);
        releaseUnrestoredStoredControllers({
            restored: restoredStoredControllerDevices,
            sampleFrameOnTrack: (trackId) =>
                placeSamplesOnClock({
                    startSamples: destinationSamples,
                    accumulatedSamples,
                    sampleRate,
                    compensation: getCompensationDelay(trackId),
                }).sampleFrame,
        });
    }
}
