import { type NativeDspDeviceType } from '#/utils/nativeDspDeviceTypes';

import { isBacteriaDevice, createBacteriaNode } from '../../engine/BacteriaNode';
import { isCrumbsDevice, createCrumbsNode } from '../../engine/CrumbsNode';
import { isCrustDevice, createCrustNode } from '../../engine/CrustNode';
import { isFermenterDevice, createFermenterNode } from '../../engine/FermenterNode';
import { isGlutenDevice, createGlutenNode } from '../../engine/GlutenNode';
import { isGrandBouleDevice, createGrandBouleNode } from '../../engine/GrandBouleNode';
import { isGrinderDevice, createGrinderNode } from '../../engine/GrinderNode';
import { isKneadDevice, createKneadNode } from '../../engine/KneadNode';
import { isLevainDevice, createLevainNode } from '../../engine/LevainNode';
import { isProofChamberDevice, createProofChamberNode } from '../../engine/ProofChamberNode';
import { isProofDevice, createProofNode } from '../../engine/ProofNode';
import { isScoringDevice, createScoringNode } from '../../engine/ScoringNode';
import { isToasterDevice, createToasterNode } from '../../engine/ToasterNode';
import { type DeviceRuntimeOfflineFacts } from '../../models/BuiltinDeviceRuntime';

import {
    type DeviceNoteOffRequest,
    type DeviceNoteOnRequest,
    type OfflineAutomationSegment,
} from './AudioDeviceStrategy';

export type NativeDspNode = {
    workletNode: AudioWorkletNode;
    setParam?: (name: string, value: number) => void;
    acceptsScheduledParam?: (name: string) => boolean;
    scheduleParam?: (name: string, segments: readonly OfflineAutomationSegment[]) => void;
    setBypass?: (bypassed: boolean) => void;
    noteOn?: (request: DeviceNoteOnRequest) => void;
    noteOff?: (request: DeviceNoteOffRequest) => void;
    connectPadOutput?: (pad: number, destination: AudioNode) => void;
    disconnectPadOutput?: (pad: number, destination: AudioNode) => void;
    setPadDryRouted?: (pad: number, routed: boolean) => void;
    destroy?: () => void;
    ready: Promise<Record<string, unknown>>;
    runtimeFailure?: Promise<never>;
    runtimeHealthCheck?: () => Promise<void>;
};

/**
 * A node whose note surface has been mapped onto the named request contract.
 *
 * The two binders below produce this by spreading the node. That is a shallow
 * copy, and it is only correct because all four note-voicing factories return
 * plain object literals whose methods close over local state — no classes, no
 * getters, no `this`. A future node that is a class instance or exposes an
 * accessor would lose behaviour here while still satisfying this type. Wrap it
 * explicitly rather than spreading if that day comes.
 */
type NoteBoundNode<TNode> = Omit<TNode, 'noteOn' | 'noteOff'> & Required<Pick<NativeDspNode, 'noteOn' | 'noteOff'>>;

/**
 * The melodic instruments — Fermenter, Levain, Grand Boule, Crumbs — all publish
 * `noteOn` as `(note, velocity, sampleFrame?, channel?)`.
 *
 * Their `noteOff` signatures do not agree, so there is one binder per shape
 * rather than one for all four. Fermenter and Levain take
 * `(note, sampleFrame?, channel?)`; Grand Boule puts a release velocity in slot
 * 3 and its channel in slot 4; Crumbs has no channel surface. Binding them all
 * through a single `(note, sampleFrame?)` adapter compiled — the trailing
 * parameters are optional — and silently dropped the member channel, so an
 * offline release could not tell two notes at the same pitch apart.
 */
type MelodicNoteOn = (note: number, velocity: number, sampleFrame?: number, channel?: number) => void;

type ChannelReleaseNoteNode = {
    noteOn: MelodicNoteOn;
    noteOff: (note: number, sampleFrame?: number, channel?: number) => void;
};

type PlainReleaseNoteNode = {
    noteOn: MelodicNoteOn;
    noteOff: (note: number, sampleFrame?: number) => void;
};

type ReleaseVelocityNoteNode = {
    noteOn: MelodicNoteOn;
    noteOff: (note: number, sampleFrame?: number, releaseVelocity?: number, channel?: number) => void;
};

type ArticulatedMelodicNoteNode = {
    noteOn: (note: number, velocity: number, sampleFrame?: number, channel?: number, articulationId?: number) => void;
    noteOff: (note: number, sampleFrame?: number, channel?: number) => void;
};

/** Toaster is pad-addressed: `(pad, velocity, midiNote?, sampleFrame?)`. */
type PadNoteNode = {
    noteOn: (pad: number, velocity: number, midiNote?: number, sampleFrame?: number) => void;
    noteOff: (pad: number, sampleFrame?: number) => void;
};

function bindMelodicNotes<TNode extends PlainReleaseNoteNode>(node: TNode): NoteBoundNode<TNode> {
    return {
        ...node,
        noteOn: ({ noteOrPad, velocity, sampleFrame, channel }) =>
            node.noteOn(noteOrPad, velocity, sampleFrame, channel),
        noteOff: ({ noteOrPad, sampleFrame }) => node.noteOff(noteOrPad, sampleFrame),
    };
}

function bindChannelReleaseMelodicNotes<TNode extends ChannelReleaseNoteNode>(node: TNode): NoteBoundNode<TNode> {
    return {
        ...node,
        noteOn: ({ noteOrPad, velocity, sampleFrame, channel }) =>
            node.noteOn(noteOrPad, velocity, sampleFrame, channel),
        noteOff: ({ noteOrPad, sampleFrame, channel }) => node.noteOff(noteOrPad, sampleFrame, channel),
    };
}

function bindReleaseVelocityMelodicNotes<TNode extends ReleaseVelocityNoteNode>(node: TNode): NoteBoundNode<TNode> {
    return {
        ...node,
        noteOn: ({ noteOrPad, velocity, sampleFrame, channel }) =>
            node.noteOn(noteOrPad, velocity, sampleFrame, channel),
        // Slot 3 is the release velocity this path has no value for; the
        // channel belongs in slot 4.
        noteOff: ({ noteOrPad, sampleFrame, channel }) => node.noteOff(noteOrPad, sampleFrame, undefined, channel),
    };
}

function bindArticulatedMelodicNotes<TNode extends ArticulatedMelodicNoteNode>(node: TNode): NoteBoundNode<TNode> {
    return {
        ...node,
        noteOn: ({ noteOrPad, velocity, sampleFrame, channel, articulationId }) =>
            node.noteOn(noteOrPad, velocity, sampleFrame, channel, articulationId),
        noteOff: ({ noteOrPad, sampleFrame, channel }) => node.noteOff(noteOrPad, sampleFrame, channel),
    };
}

function bindPadNotes<TNode extends PadNoteNode>(node: TNode): NoteBoundNode<TNode> {
    return {
        ...node,
        noteOn: ({ noteOrPad, velocity, midiNote, sampleFrame }) =>
            node.noteOn(noteOrPad, velocity, midiNote, sampleFrame),
        noteOff: ({ noteOrPad, sampleFrame }) => node.noteOff(noteOrPad, sampleFrame),
    };
}

type RuntimeFailureChannel = {
    readonly promise: Promise<never>;
    report: (message: string) => void;
};

function createRuntimeFailureChannel(): RuntimeFailureChannel {
    let rejectRuntimeFailure: ((error: Error) => void) | undefined;
    const runtimeFailure = new Promise<never>((_resolve, reject) => {
        rejectRuntimeFailure = reject;
    });
    // The render kernel adopts this signal only after every strip is prepared.
    // Observe an earlier fault without consuming the rejection it will race.
    void runtimeFailure.catch(() => undefined);

    return {
        promise: runtimeFailure,
        report: (message) => {
            rejectRuntimeFailure?.(new Error(message));
            rejectRuntimeFailure = undefined;
        },
    };
}

async function createFermenterOfflineNode(ctx: BaseAudioContext): Promise<NativeDspNode> {
    const runtimeFailure = createRuntimeFailureChannel();
    const node = await createFermenterNode(ctx, undefined, runtimeFailure.report);
    return { ...bindChannelReleaseMelodicNotes(node), runtimeFailure: runtimeFailure.promise };
}

async function createLevainOfflineNode(ctx: BaseAudioContext): Promise<NativeDspNode> {
    const runtimeFailure = createRuntimeFailureChannel();
    const node = await createLevainNode(ctx, undefined, runtimeFailure.report);
    return { ...bindArticulatedMelodicNotes(node), runtimeFailure: runtimeFailure.promise };
}

async function createCrumbsOfflineNode(ctx: BaseAudioContext): Promise<NativeDspNode> {
    const runtimeFailure = createRuntimeFailureChannel();
    const node = await createCrumbsNode(ctx, undefined, runtimeFailure.report);
    return { ...bindMelodicNotes(node), runtimeFailure: runtimeFailure.promise };
}

async function createGrandBouleOfflineNode(ctx: BaseAudioContext): Promise<NativeDspNode> {
    const runtimeFailure = createRuntimeFailureChannel();
    const node = await createGrandBouleNode(ctx, undefined, runtimeFailure.report);
    return {
        ...bindReleaseVelocityMelodicNotes(node),
        runtimeFailure: runtimeFailure.promise,
        runtimeHealthCheck: node.runtimeHealthCheck,
    };
}

type NativeDspDeviceFactory = {
    /**
     * The canonical type this factory builds.
     *
     * Declared alongside `matches` rather than derived from it, because a
     * predicate cannot be asked what it accepts. It is what welds this list to
     * `NATIVE_DSP_DEVICE_TYPES` and therefore to the hydration table in the
     * composition root: a device added here without a canonical type does not
     * compile, and `nativeDspDeviceTypeWeld.spec.ts` asserts every declared type
     * is one its own `matches` actually claims, so the two cannot drift apart
     * silently.
     */
    readonly type: NativeDspDeviceType;
    readonly matches: (deviceType: string) => boolean;
    readonly create: (ctx: BaseAudioContext) => Promise<NativeDspNode>;
    readonly runtime: DeviceRuntimeOfflineFacts;
};

const NATIVE_DSP_OFFLINE_RUNTIME: DeviceRuntimeOfflineFacts = {
    source: 'AudioEngine.nativeDspDeviceFactories',
    availability: 'available',
};

/**
 * The one list of native DSP devices the offline path can build.
 *
 * The device registry's matcher and the strategy factory's dispatch used to be
 * two hand-maintained lists, and they drifted: `grand-boule` had a branch in the
 * factory but was missing from the matcher, so no factory claimed it,
 * `createDevice` threw, and `buildDeviceChain` skipped it — a frozen or bounced
 * GrandBoule track rendered silence. Live playback was unaffected (it goes
 * through `wasmDeviceRegistry`), which is why the gap survived. Both the matcher
 * and the factory now read this table, so a device cannot be buildable yet
 * unreachable (MD-4 review).
 *
 * The note-voicing entries wrap their node in the adapter for that device's own
 * note API. This is the only place a positional note call is still written, and
 * each one sits beside the device whose signature it encodes. The compiler will
 * not catch an entry bound to the wrong adapter — every adapter's parameter
 * types are mutually assignable, since each slot is `number | undefined` and
 * names carry no weight — so `nativeDspNoteBinding.spec.ts` asserts the slots
 * each of these five bindings actually produces, for release as well as attack.
 */
export const NATIVE_DSP_DEVICE_FACTORIES: readonly NativeDspDeviceFactory[] = [
    {
        type: 'fermenter',
        matches: isFermenterDevice,
        create: createFermenterOfflineNode,
        runtime: NATIVE_DSP_OFFLINE_RUNTIME,
    },
    {
        type: 'toaster',
        matches: isToasterDevice,
        create: async (ctx) => bindPadNotes(await createToasterNode(ctx)),
        runtime: NATIVE_DSP_OFFLINE_RUNTIME,
    },
    {
        type: 'levain',
        matches: isLevainDevice,
        create: createLevainOfflineNode,
        runtime: NATIVE_DSP_OFFLINE_RUNTIME,
    },
    // Crumbs' catalog id carries the `builtin-` prefix, so `createDeviceRegistry`
    // has to let this table claim it ahead of the `builtin-` WebAudio arm — see
    // the exclusion there. Every other native id is unprefixed. Melodic, not pad:
    // Crumbs is addressed by pitch against the active sample's root note.
    {
        type: 'builtin-crumbs',
        matches: isCrumbsDevice,
        create: createCrumbsOfflineNode,
        runtime: NATIVE_DSP_OFFLINE_RUNTIME,
    },
    {
        type: 'grand-boule',
        matches: isGrandBouleDevice,
        create: createGrandBouleOfflineNode,
        runtime: NATIVE_DSP_OFFLINE_RUNTIME,
    },
    { type: 'gluten', matches: isGlutenDevice, create: createGlutenNode, runtime: NATIVE_DSP_OFFLINE_RUNTIME },
    { type: 'crust', matches: isCrustDevice, create: createCrustNode, runtime: NATIVE_DSP_OFFLINE_RUNTIME },
    {
        type: 'bacteria',
        matches: isBacteriaDevice,
        create: createBacteriaNode,
        runtime: NATIVE_DSP_OFFLINE_RUNTIME,
    },
    { type: 'grinder', matches: isGrinderDevice, create: createGrinderNode, runtime: NATIVE_DSP_OFFLINE_RUNTIME },
    { type: 'proof', matches: isProofDevice, create: createProofNode, runtime: NATIVE_DSP_OFFLINE_RUNTIME },
    {
        type: 'dutch-oven',
        matches: isProofChamberDevice,
        create: createProofChamberNode,
        runtime: NATIVE_DSP_OFFLINE_RUNTIME,
    },
    {
        type: 'native-scoring',
        matches: isScoringDevice,
        create: createScoringNode,
        runtime: NATIVE_DSP_OFFLINE_RUNTIME,
    },
    { type: 'knead', matches: isKneadDevice, create: createKneadNode, runtime: NATIVE_DSP_OFFLINE_RUNTIME },
];

export function isNativeDspDevice(deviceType: string): boolean {
    return NATIVE_DSP_DEVICE_FACTORIES.some((factory) => factory.matches(deviceType));
}
