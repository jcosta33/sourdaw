import {
    type CompAudioSourceFieldPresenceSnapshot,
    type CompAudioSourcePromotionSnapshot,
} from '#/utils/handlerContract';

import { type CompRegion, type MidiTakeSource, type Take, type TakeLane } from '../models/TakeLane';

import { type OptionalAudioSourceTiles } from './baseGapAudioSourceDelta';
import { type CompAudioSourceAuthorization } from './compAudioSourcePromotions';
import { type TempoAudioSourceWriteIntent } from './tempoAudioSourceWriteIntent';

export type TakeLaneStoreValue = {
    lanes: TakeLane[];
};

export type TakeLaneCompRegionPatch = {
    readonly laneId: string;
    readonly trackId: string;
    readonly startBeat: number;
    readonly endBeat: number;
    readonly expected: readonly CompRegion[];
    readonly replacement: readonly CompRegion[];
    readonly audioSourcePromotions?: readonly CompAudioSourcePromotionSnapshot[];
    readonly baseGapAudioSourceFieldPresence?: CompAudioSourceFieldPresenceSnapshot;
};

export type OptionalStringValue = { readonly present: false } | { readonly present: true; readonly value: string };

export type OptionalNumberValue = { readonly present: false } | { readonly present: true; readonly value: number };
export type OptionalMidiSourceValue =
    { readonly present: false } | { readonly present: true; readonly value: MidiTakeSource };

export type OptionalTakeNumberField =
    | 'sourceOffsetBeats'
    | 'sourceOffsetSeconds'
    | 'passAnchorSeconds'
    | 'passDepthSeconds'
    | 'passSourceEndSeconds'
    | 'passOriginBeat'
    | 'passOriginSourceSeconds'
    | 'recordingPassIndex';

export type TakeFieldOperation =
    | {
          readonly kind: 'take-string-field';
          readonly laneId: string;
          readonly takeId: string;
          readonly field: 'clipId' | 'name';
          readonly expected: string;
          readonly replacement: string;
      }
    | {
          readonly kind: 'take-number-field';
          readonly laneId: string;
          readonly takeId: string;
          readonly field: 'startBeat' | 'endBeat';
          readonly expected: number;
          readonly replacement: number;
      }
    | {
          readonly kind: 'take-selected-field';
          readonly laneId: string;
          readonly takeId: string;
          readonly expected: boolean;
          readonly replacement: boolean;
      }
    | {
          readonly kind: 'take-optional-number-field';
          readonly laneId: string;
          readonly takeId: string;
          readonly field: OptionalTakeNumberField;
          readonly expected: OptionalNumberValue;
          readonly replacement: OptionalNumberValue;
      }
    | {
          readonly kind: 'take-midi-source-field';
          readonly laneId: string;
          readonly takeId: string;
          readonly expected: OptionalMidiSourceValue;
          readonly replacement: OptionalMidiSourceValue;
      }
    | {
          readonly kind: 'take-midi-source-phase';
          readonly laneId: string;
          readonly takeId: string;
          readonly expected: number;
          readonly replacement: number;
      }
    | {
          readonly kind: 'take-midi-source-note-row';
          readonly laneId: string;
          readonly takeId: string;
          readonly expected: MidiTakeSource['rows']['notes']['value'][number] | null;
          readonly replacement: MidiTakeSource['rows']['notes']['value'][number] | null;
          readonly expectedSlotPresent: boolean;
          readonly replacementSlotPresent: boolean;
      }
    | {
          readonly kind: 'take-midi-source-cc-row';
          readonly laneId: string;
          readonly takeId: string;
          readonly expected: MidiTakeSource['rows']['controlChanges']['value'][number] | null;
          readonly replacement: MidiTakeSource['rows']['controlChanges']['value'][number] | null;
          readonly expectedSlotPresent: boolean;
          readonly replacementSlotPresent: boolean;
      }
    | {
          readonly kind: 'take-midi-source-bend-row';
          readonly laneId: string;
          readonly takeId: string;
          readonly expected: MidiTakeSource['rows']['pitchBends']['value'][number] | null;
          readonly replacement: MidiTakeSource['rows']['pitchBends']['value'][number] | null;
          readonly expectedSlotPresent: boolean;
          readonly replacementSlotPresent: boolean;
      };

export type TakeLaneWriteOperation =
    | { readonly kind: 'tempo-audio-sources'; readonly intent: TempoAudioSourceWriteIntent }
    | {
          readonly kind: 'replace-state';
          readonly expected: TakeLaneStoreValue | null;
          readonly replacement: TakeLaneStoreValue | null;
      }
    | {
          readonly kind: 'comp-region-interval';
          readonly patch: TakeLaneCompRegionPatch;
          readonly sourceAuthorizations?: readonly CompAudioSourceAuthorization[];
      }
    | {
          readonly kind: 'replace-base-gap-audio-sources';
          readonly laneId: string;
          readonly expected: OptionalAudioSourceTiles;
          readonly replacement: OptionalAudioSourceTiles;
      }
    | { readonly kind: 'insert-lane'; readonly lane: TakeLane; readonly afterLaneId: string | null }
    | { readonly kind: 'remove-lane'; readonly laneId: string }
    | {
          readonly kind: 'lane-track-field';
          readonly laneId: string;
          readonly expected: string;
          readonly replacement: string;
      }
    | {
          readonly kind: 'lane-automation-field';
          readonly laneId: string;
          readonly expected: OptionalStringValue;
          readonly replacement: OptionalStringValue;
      }
    | {
          readonly kind: 'insert-take';
          readonly laneId: string;
          readonly take: Take;
          readonly afterTakeId: string | null;
      }
    | { readonly kind: 'remove-take'; readonly laneId: string; readonly takeId: string }
    | TakeFieldOperation
    | {
          readonly kind: 'replace-comp-regions';
          readonly laneId: string;
          readonly expected: readonly CompRegion[];
          readonly replacement: readonly CompRegion[];
      };

export type TakeLaneWriteJournal = readonly TakeLaneWriteOperation[];

export type TakeLaneWriteIntent =
    | { readonly kind: 'tempo-audio-sources'; readonly intent: TempoAudioSourceWriteIntent }
    | {
          readonly kind: 'comp-region-interval';
          readonly patch: TakeLaneCompRegionPatch;
          readonly sourceAuthorizations?: readonly CompAudioSourceAuthorization[];
      }
    | { readonly kind: 'replace-state' };

export type LaneWriteOperation = Exclude<
    TakeLaneWriteOperation,
    | { readonly kind: 'replace-state' }
    | { readonly kind: 'comp-region-interval' }
    | { readonly kind: 'tempo-audio-sources' }
    | { readonly kind: 'insert-lane' }
    | { readonly kind: 'remove-lane' }
>;
