import { type SendAutomationRangeSnapshot } from '../models/SendAutomationRangeSnapshot';

import { type AutomationPointSnapshot } from './automationSnapshots';

type AutomationLaneInsertion =
    | { kind: 'point'; point: Omit<AutomationPointSnapshot, 'id'> }
    | { kind: 'split'; beat: number }
    | {
          kind: 'shape';
          shape: 'sine' | 'triangle' | 'sawtooth-up' | 'sawtooth-down' | 'square' | 'random';
          startBeat: number;
          endBeat: number;
          cycles?: number;
      };

type AutomationLaneInsertionOwner = { trackId: string; parameterId: string; clipId?: string };

type AutomationLaneInsertionCapture = {
    laneObjectId: string;
    minValue: number;
    maxValue: number;
    editId: string;
    before: AutomationPointSnapshot[];
    after: AutomationPointSnapshot[];
    changedBeats: number[];
    changedPointIds: string[];
};

export type AutomationAppAction =
    | { type: 'addModulator'; payload: { modulator: Omit<ModulatorSnapshot, 'id'>; modulatorId?: string } }
    | { type: 'removeModulator'; payload: { modulatorId: string } }
    | {
          type: 'updateModulator';
          payload: { modulatorId: string; patch: { name?: string; enabled?: boolean; trackId?: string } };
      }
    | { type: 'addMapping'; payload: { modulatorId: string; mapping: ModulatorMappingSnapshot } }
    | {
          type: 'removeMapping';
          payload: {
              modulatorId: string;
              target: Pick<ModulatorMappingSnapshot, 'targetTrackId' | 'targetDeviceId' | 'targetParamId'>;
          };
      }
    | {
          type: 'addAutomationLane';
          payload: { trackId: string; parameterId: string; parameterName: string; laneId?: string };
      }
    | {
          type: 'automateSendRange';
          payload: {
              trackIds: string[];
              busId: string;
              sectionName: string;
              reductionDb: number;
              busName?: string;
              sectionId?: string;
              startBeat?: number;
              endBeat?: number;
              expectedSends?: Array<{ trackId: string; level: number; preFader: boolean }>;
              expectedSection?: { name: string; startBeat: number; endBeat: number };
          };
      }
    | {
          type: 'automateSendRanges';
          payload: {
              trackIds: string[];
              busId: string;
              sectionIds: string[];
              tailBars: number;
              targetLevelDb: number;
              busName?: string;
              expectedTimeSignature?: [number, number];
              ranges?: SendAutomationRangeSnapshot[];
              expectedTracks?: Array<{
                  trackId: string;
                  trackName: string;
                  frozen: boolean;
                  automationMode: AutomationMode;
                  sendLevel: number;
                  sendPreFader: boolean;
              }>;
          };
      }
    | {
          /** Internal guarded inverse for `automateSendRanges`. */
          type: 'removeSendAutomationRanges';
          payload: {
              trackIds: string[];
              busId: string;
              sectionIds: string[];
              tailBars: number;
              targetLevelDb: number;
              busName: string;
              expectedTimeSignature: [number, number];
              ranges: SendAutomationRangeSnapshot[];
              expectedTracks: Array<{
                  trackId: string;
                  trackName: string;
                  frozen: boolean;
                  automationMode: AutomationMode;
                  sendLevel: number;
                  sendPreFader: boolean;
              }>;
          };
      }
    | {
          type: 'automateTrackGainRange';
          payload: {
              trackIds: string[];
              sectionName: string;
              gainDb: number;
              sectionId?: string;
              startBeat?: number;
              endBeat?: number;
              expectedTracks?: Array<{
                  trackId: string;
                  trackName: string;
                  gain: number;
                  automationMode: 'read' | 'write' | 'touch' | 'latch' | 'off';
                  frozen: boolean;
              }>;
              expectedSection?: { name: string; startBeat: number; endBeat: number };
          };
      }
    | {
          /**
           * Hold one track parameter at a target across a musical range, ramping in
           * from and back out to the value its lane already draws there, and leaving
           * the lane's curve outside the range unchanged.
           *
           * `range` is what the caller asked for and stays as asked. `startBeat` and
           * `endBeat` are the half-open interval it resolves to, materialized by the
           * owning handler when the command is admitted, so scope and lock checks read
           * the beats the write will actually cover.
           */
          type: 'automateParameterRange';
          payload: {
              trackId: string;
              /** `gain`, `pan`, `send:<busId>`, or `<deviceId>:<paramId>`. */
              parameterId: string;
              /** Exactly one form: `section`, `section` with `barsBefore`, `startBar` with `endBar`, or `startBeat` with `endBeat`. */
              range: {
                  /** A section name, optionally with an ordinal: "Chorus 2", "the second chorus". */
                  section?: string;
                  /** With `section`: the N whole bars that end where that section starts. */
                  barsBefore?: number;
                  /** First bar, 1-based. */
                  startBar?: number;
                  /** Last bar, inclusive. */
                  endBar?: number;
                  startBeat?: number;
                  /** Exclusive. */
                  endBeat?: number;
              };
              /** Absolute level in decibels, gain and send targets only. Exactly one of `valueDb`, `deltaDb`, `value`. */
              valueDb?: number;
              /** Change in decibels from the level the lane draws at the range start, gain and send targets only. */
              deltaDb?: number;
              /** The target in the lane's own units. */
              value?: number;
              /** Length of the ramp into the target, in beats, from the range start. */
              rampIn?: number;
              /** Length of the ramp back out, in beats, ending at the range end. */
              rampOut?: number;
              /** Resolved range start, materialized at admission. Command-owned. */
              startBeat?: number;
              /** Resolved range end, exclusive, materialized at admission. Command-owned. */
              endBeat?: number;
              /** Command-owned identity of this write's lane and points, for exact undo and redo. AiRuntime rejects provider input. */
              writeId?: string;
          };
      }
    | {
          /** Internal guarded inverse for `automateTrackGainRange`. */
          type: 'removeTrackGainAutomationRange';
          payload: {
              trackIds: string[];
              sectionName: string;
              gainDb: number;
              sectionId: string;
              startBeat: number;
              endBeat: number;
              expectedTracks: Array<{
                  trackId: string;
                  trackName: string;
                  gain: number;
                  automationMode: 'read' | 'write' | 'touch' | 'latch' | 'off';
                  frozen: boolean;
              }>;
              expectedSection: { name: string; startBeat: number; endBeat: number };
          };
      }
    | {
          /** Internal guarded inverse for `automateSendRange`. */
          type: 'removeSendAutomationRange';
          payload: {
              trackIds: string[];
              busId: string;
              sectionName: string;
              reductionDb: number;
              busName: string;
              sectionId: string;
              startBeat: number;
              endBeat: number;
              expectedSends: Array<{ trackId: string; level: number; preFader: boolean }>;
              expectedSection: { name: string; startBeat: number; endBeat: number };
          };
      }
    | {
          /** Inverse of `addAutomationLane`, keyed by the exact id allocated before execute.
           *  `expectedPoints` is set by an inverse that created the lane together with
           *  its points: the lane is removed only while it holds exactly those points. */
          type: 'removeAutomationLane';
          payload: { laneId: string; expectedPoints?: readonly AutomationPointSnapshot[] };
      }
    | { type: 'setAutomationLaneEnabled'; payload: { laneId: string; enabled: boolean } }
    | {
          /** Local point and shape insertion, materialized by the owning Automation handler. */
          type: 'insertAutomationLanePoints';
          payload: {
              laneId: string;
              owner: AutomationLaneInsertionOwner;
              insertion: AutomationLaneInsertion;
              capture?: AutomationLaneInsertionCapture;
              direction?: 'undo';
          };
      }
    | {
          type: 'addAutomationPoint';
          /**
           * Exactly one level form is stated. The decibel forms are resolved by the
           * handler against the live value; the store keeps a linear amplitude
           * whichever form asked. Two forms at once is a contradiction rather than a
           * preference, and none at all leaves nothing to write, so both are refused
           * by the handler and by the AiRuntime payload validator.
           *
           * `valueDb` and `deltaDb` are legal only on a lane whose values *are* linear
           * gain amplitudes; every other lane measures something decibels do not
           * describe.
           */
          payload: {
              laneId: string;
              /** Command-owned stable identity for exact undo/redo. AiRuntime rejects provider input. */
              pointId?: string;
              beat: number;
              curve?: 'linear' | 'step' | 'exponential' | 's-curve' | 'stairs' | 'smooth' | 'bezier';
              tension?: number;
              stairSteps?: number;
              cp1?: { x: number; y: number };
              cp2?: { x: number; y: number };
              /** The lane's own units. Exactly one of `value`, `valueDb`, `deltaDb`. */
              value?: number;
              /** Absolute level in decibels, gain lanes only. */
              valueDb?: number;
              /** Change relative to the level the gain lane already draws at this beat. */
              deltaDb?: number;
          };
      }
    | {
          type: 'removeAutomationPoint';
          payload: {
              laneId: string;
              pointIndex: number;
              /** Internal stable target. AiRuntime rejects provider input. */
              pointId?: string;
          };
      }
    | { type: 'scaleAutomation'; payload: { laneId: string; factor: number; anchor?: number } }
    | { type: 'stretchAutomation'; payload: { laneId: string; factor: number; anchorBeat?: number } }
    | { type: 'invertAutomation'; payload: { laneId: string } }
    | { type: 'reverseAutomation'; payload: { laneId: string } }
    | { type: 'thinAutomation'; payload: { laneId: string; tolerance?: number } }
    | { type: 'quantizeAutomation'; payload: { laneId: string; gridSize: number } }
    | {
          /** Inverse of the automation transform handlers (reverse/scale/stretch/thin/
           *  quantize/invert). Restores a lane's `points` to a snapshot captured
           *  pre-execute. Emitted only by those handlers' `describe()` — not invoked
           *  directly. Keep mirrored in AiRuntime/models/RuntimeAction.ts. */
          type: 'restoreAutomationLanePoints';
          payload: {
              laneId: string;
              points: readonly AutomationPointSnapshot[];
              expectedPoints?: readonly AutomationPointSnapshot[];
          };
      }
    | {
          /** Internal point-scoped replay for linked-follower removal undo/redo. */
          type: 'restoreAutomationPointPresence';
          payload: {
              laneId: string;
              owner: {
                  trackId: string;
                  parameterId: string;
                  clipId?: string;
                  linkedLaneId: string;
              };
              point: AutomationPointSnapshot;
              equalBeatIndex: number;
              expectedEqualBeatPoints: readonly AutomationPointSnapshot[];
              expectedPresence: 'present' | 'absent';
              replacementPresence: 'present' | 'absent';
          };
      };

declare module '#/utils/handlerContract' {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- declaration-merging target: a type alias cannot merge
    interface AppActionRegistry {
        automation: AutomationAppAction;
    }
}

export type ModulatorMappingSnapshot = {
    readonly targetTrackId: string;
    readonly targetDeviceId: string;
    readonly targetParamId: string;
    readonly amount: number;
};
export type ModulatorSnapshot = {
    readonly id: string;
    readonly name: string;
    readonly trackId: string;
    readonly enabled: boolean;
    readonly mappings: readonly ModulatorMappingSnapshot[];
    readonly kind: 'lfo' | 'envelope' | 'step';
    readonly config:
        | {
              readonly kind: 'lfo';
              readonly waveform: 'sine' | 'square' | 'saw' | 'triangle' | 'random';
              readonly rate: number;
              readonly sync: boolean;
              readonly phase: number;
              readonly depth: number;
          }
        | {
              readonly kind: 'envelope';
              readonly attack: number;
              readonly decay: number;
              readonly sustain: number;
              readonly release: number;
              readonly triggerMode: 'midi' | 'audio' | 'sync';
          }
        | {
              readonly kind: 'step';
              readonly steps: readonly number[];
              readonly rate: number;
              readonly smooth: number;
          };
};
export type IncomingModulationMappingSnapshot = {
    readonly modulatorId: string;
    readonly mapping: ModulatorMappingSnapshot;
};
export type AutomationMode = 'read' | 'write' | 'touch' | 'latch' | 'off';
