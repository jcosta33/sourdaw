import type { AppAction } from '#/utils/handlerContract';

export type ControllerIntegerRangeV1 = Readonly<{
    min: number;
    max: number;
}>;

export type ControllerInputV1 =
    | Readonly<{
          kind: 'note';
          channel: number;
          note: number;
          value: ControllerIntegerRangeV1;
      }>
    | Readonly<{
          kind: 'cc';
          channel: number;
          controller: number;
          value: ControllerIntegerRangeV1;
      }>
    | Readonly<{
          kind: 'pitch-bend';
          channel: number;
          value: ControllerIntegerRangeV1;
      }>
    | Readonly<{
          kind: 'channel-pressure';
          channel: number;
          value: ControllerIntegerRangeV1;
      }>
    | Readonly<{
          kind: 'relative-encoder';
          channel: number;
          controller: number;
          encoding: 'binary-offset' | "two's-complement" | 'signed-bit';
          value: ControllerIntegerRangeV1;
      }>
    | Readonly<{
          kind: 'button-edge';
          source: 'note' | 'cc';
          channel: number;
          number: number;
          value: number;
          edge: 'press' | 'release';
      }>;

export type CurrentTargetResolverV1 =
    | Readonly<{ kind: 'selected-track-id' }>
    | Readonly<{ kind: 'track-bank-slot-id'; slot: number }>
    | Readonly<{ kind: 'focused-clip-id' }>
    | Readonly<{ kind: 'selected-device-id' }>
    | Readonly<{ kind: 'selected-device-parameter-id'; slot: number }>
    | Readonly<{ kind: 'selected-send-id'; slot: number }>;

export type ControllerActionValueV1 =
    | Readonly<{
          source: 'constant';
          value: string | number | boolean | null;
      }>
    | Readonly<{ source: 'input-value' }>
    | Readonly<{ source: 'button-state' }>
    | Readonly<{
          source: 'current-target';
          resolver: CurrentTargetResolverV1;
      }>;

export type ControllerActionTemplateV1 = Readonly<{
    type: AppAction['type'];
    payload: Readonly<Record<string, ControllerActionValueV1>> | null;
}>;

export type ControllerBehaviorV1 =
    | Readonly<{ kind: 'jump' }>
    | Readonly<{ kind: 'pickup' }>
    | Readonly<{ kind: 'scaled-pickup' }>
    | Readonly<{
          kind: 'relative';
          sensitivity: number;
          acceleration: Readonly<{ kind: 'none' }> | Readonly<{ kind: 'linear'; factor: number }>;
      }>;

export type ControllerCurveV1 =
    | Readonly<{ kind: 'linear' }>
    | Readonly<{ kind: 'log'; base: number }>
    | Readonly<{ kind: 'exp'; exponent: number }>;

export type ControllerFeedbackV1 =
    | Readonly<{
          kind: 'note';
          channel: number;
          note: number;
          offValue: number;
          onValue: number;
      }>
    | Readonly<{
          kind: 'cc';
          channel: number;
          controller: number;
          value: ControllerIntegerRangeV1;
      }>
    | Readonly<{
          kind: 'pitch-bend';
          channel: number;
          value: ControllerIntegerRangeV1;
      }>;

export type ControllerMappingV1 = Readonly<{
    id: string;
    input: ControllerInputV1;
    action: ControllerActionTemplateV1;
    behavior: ControllerBehaviorV1;
    curve: ControllerCurveV1;
    feedback?: ControllerFeedbackV1;
    layer?: string;
    mode?: string;
}>;

export type ControllerMappingSchemaV1 = Readonly<{
    schemaVersion: 1;
    mappings: readonly ControllerMappingV1[];
}>;
