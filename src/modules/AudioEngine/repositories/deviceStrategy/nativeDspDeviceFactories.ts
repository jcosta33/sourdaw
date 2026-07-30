import { isBacteriaDevice, createBacteriaNode } from '../../engine/BacteriaNode';
import { isCrumbsDevice, createCrumbsNode } from '../../engine/CrumbsNode';
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

import { type OfflineAutomationSegment } from './AudioDeviceStrategy';

export type NativeDspNode = {
    workletNode: AudioWorkletNode;
    setParam?: (name: string, value: number) => void;
    acceptsScheduledParam?: (name: string) => boolean;
    scheduleParam?: (name: string, segments: readonly OfflineAutomationSegment[]) => void;
    setBypass?: (bypassed: boolean) => void;
    noteOn?: (noteOrPad: number, velocity: number, midiNote?: number, sampleFrame?: number) => void;
    noteOff?: (noteOrPad: number, sampleFrame?: number) => void;
    connectPadOutput?: (pad: number, destination: AudioNode) => void;
    disconnectPadOutput?: (pad: number, destination: AudioNode) => void;
    setPadDryRouted?: (pad: number, routed: boolean) => void;
    destroy?: () => void;
    ready: Promise<Record<string, unknown>>;
};

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
 */
export const NATIVE_DSP_DEVICE_FACTORIES: readonly NativeDspDeviceFactory[] = [
    { matches: isFermenterDevice, create: createFermenterNode },
    { matches: isToasterDevice, create: createToasterNode },
    { matches: isLevainDevice, create: createLevainNode },
    // Crumbs' catalog id is `builtin-crumbs`, so `createDeviceRegistry` has to
    // let this table claim it before the `builtin-` WebAudio arm — see the
    // exclusion there. Every other native id is unprefixed.
    { matches: isCrumbsDevice, create: createCrumbsNode },
    { matches: isGrandBouleDevice, create: createGrandBouleNode },
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
