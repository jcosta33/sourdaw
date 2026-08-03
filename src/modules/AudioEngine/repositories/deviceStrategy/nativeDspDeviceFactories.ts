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
 * The melodic instruments — Fermenter, Levain, Grand Boule — all publish
 * `(note, velocity, sampleFrame?, channel?)`. Grand Boule's `noteOff` carries a
 * release velocity in slot 3, which this path has no value for and omits.
 */
type MelodicNoteNode = {
    noteOn: (note: number, velocity: number, sampleFrame?: number, channel?: number) => void;
    noteOff: (note: number, sampleFrame?: number) => void;
};

/** Toaster is pad-addressed: `(pad, velocity, midiNote?, sampleFrame?)`. */
type PadNoteNode = {
    noteOn: (pad: number, velocity: number, midiNote?: number, sampleFrame?: number) => void;
    noteOff: (pad: number, sampleFrame?: number) => void;
};

function bindMelodicNotes<TNode extends MelodicNoteNode>(node: TNode): NoteBoundNode<TNode> {
    return {
        ...node,
        noteOn: ({ noteOrPad, velocity, sampleFrame, channel }) =>
            node.noteOn(noteOrPad, velocity, sampleFrame, channel),
        noteOff: ({ noteOrPad, sampleFrame }) => node.noteOff(noteOrPad, sampleFrame),
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

async function createGrandBouleOfflineNode(ctx: BaseAudioContext): Promise<NativeDspNode> {
    let rejectRuntimeFailure: ((error: Error) => void) | undefined;
    const runtimeFailure = new Promise<never>((_resolve, reject) => {
        rejectRuntimeFailure = reject;
    });
    // Rendering attaches its race after all strips and events are prepared. Keep
    // a failure during that preparation observed until the render kernel adopts
    // the same promise, rather than producing an unhandled rejection.
    void runtimeFailure.catch(() => undefined);

    const node = await createGrandBouleNode(ctx, undefined, (message) => {
        rejectRuntimeFailure?.(new Error(message));
    });
    return { ...bindMelodicNotes(node), runtimeFailure, runtimeHealthCheck: node.runtimeHealthCheck };
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
 * not catch an entry bound to the wrong adapter — the two adapter parameter
 * types are mutually assignable — so `nativeDspNoteBinding.spec.ts` asserts the
 * slots each of these five bindings actually produces.
 */
export const NATIVE_DSP_DEVICE_FACTORIES: readonly NativeDspDeviceFactory[] = [
    {
        type: 'fermenter',
        matches: isFermenterDevice,
        create: async (ctx) => bindMelodicNotes(await createFermenterNode(ctx)),
    },
    { type: 'toaster', matches: isToasterDevice, create: async (ctx) => bindPadNotes(await createToasterNode(ctx)) },
    { type: 'levain', matches: isLevainDevice, create: async (ctx) => bindMelodicNotes(await createLevainNode(ctx)) },
    // Crumbs' catalog id carries the `builtin-` prefix, so `createDeviceRegistry`
    // has to let this table claim it ahead of the `builtin-` WebAudio arm — see
    // the exclusion there. Every other native id is unprefixed. Melodic, not pad:
    // Crumbs is addressed by pitch against the active sample's root note.
    {
        type: 'builtin-crumbs',
        matches: isCrumbsDevice,
        create: async (ctx) => bindMelodicNotes(await createCrumbsNode(ctx)),
    },
    {
        type: 'grand-boule',
        matches: isGrandBouleDevice,
        create: createGrandBouleOfflineNode,
    },
    { type: 'gluten', matches: isGlutenDevice, create: createGlutenNode },
    { type: 'crust', matches: isCrustDevice, create: createCrustNode },
    { type: 'bacteria', matches: isBacteriaDevice, create: createBacteriaNode },
    { type: 'grinder', matches: isGrinderDevice, create: createGrinderNode },
    { type: 'proof', matches: isProofDevice, create: createProofNode },
    { type: 'dutch-oven', matches: isProofChamberDevice, create: createProofChamberNode },
    { type: 'native-scoring', matches: isScoringDevice, create: createScoringNode },
    { type: 'knead', matches: isKneadDevice, create: createKneadNode },
];

export function isNativeDspDevice(deviceType: string): boolean {
    return NATIVE_DSP_DEVICE_FACTORIES.some((factory) => factory.matches(deviceType));
}
