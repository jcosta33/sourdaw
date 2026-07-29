import { isBacteriaDevice, createBacteriaNode } from '../../engine/BacteriaNode';
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
};

/** A node whose note surface has been mapped onto the named request contract. */
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

type NativeDspDeviceFactory = {
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
 * each one sits beside the device whose signature it encodes.
 */
export const NATIVE_DSP_DEVICE_FACTORIES: readonly NativeDspDeviceFactory[] = [
    { matches: isFermenterDevice, create: async (ctx) => bindMelodicNotes(await createFermenterNode(ctx)) },
    { matches: isToasterDevice, create: async (ctx) => bindPadNotes(await createToasterNode(ctx)) },
    { matches: isLevainDevice, create: async (ctx) => bindMelodicNotes(await createLevainNode(ctx)) },
    { matches: isGrandBouleDevice, create: async (ctx) => bindMelodicNotes(await createGrandBouleNode(ctx)) },
    { matches: isGlutenDevice, create: createGlutenNode },
    { matches: isBacteriaDevice, create: createBacteriaNode },
    { matches: isGrinderDevice, create: createGrinderNode },
    { matches: isProofDevice, create: createProofNode },
    { matches: isProofChamberDevice, create: createProofChamberNode },
    { matches: isScoringDevice, create: createScoringNode },
    { matches: isKneadDevice, create: createKneadNode },
];

export function isNativeDspDevice(deviceType: string): boolean {
    return NATIVE_DSP_DEVICE_FACTORIES.some((factory) => factory.matches(deviceType));
}
