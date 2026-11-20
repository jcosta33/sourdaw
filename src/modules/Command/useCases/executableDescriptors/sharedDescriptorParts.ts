import { type AppActionType } from '#/utils/handlerContract';

export type ExecutableAppActionRisk =
    'bounded-reversible' | 'broad-reversible' | 'destructive-reversible' | 'authority-sensitive' | 'external-effect';

export type ExecutableAppActionTargetCapability =
    | 'track'
    | 'folder-track'
    | 'armable-track'
    | 'duplicable-track'
    | 'removable-track'
    | 'routable-source'
    | 'bus'
    | 'output'
    | 'device-host-track'
    | 'device'
    | 'sidechain-capable-device'
    | 'device-parameter'
    | 'adjustment-layer'
    | 'vca-group'
    | 'vca-member-track'
    | 'automation-lane'
    | 'clip'
    | 'editable-clip'
    | 'editable-audio-clip'
    | 'editable-midi-clip'
    | 'writable-midi-clip';

export type ExecutableAppActionTargetRule = {
    argument: string;
    capability: ExecutableAppActionTargetCapability;
    allowBatchLocal?: boolean;
    cardinality?: 'many';
    dependsOn?: string;
    distinctFrom?: string;
    promptRole?: 'source' | 'destination' | 'container' | 'members';
    optional?: boolean;
};

export type ExecutableAppActionParentTrackTargetCapability =
    | 'track'
    | 'routable-source'
    | 'bus'
    | 'device'
    | 'sidechain-capable-device'
    | 'automation-lane'
    | 'clip'
    | 'editable-clip'
    | 'editable-audio-clip'
    | 'editable-midi-clip'
    | 'writable-midi-clip';

export type ExecutableAppActionDerivedMutationIdentityArgument = 'parentTrackIds';

export type ExecutableAppActionMutationIdentityArgument =
    | {
          argument: string;
          cardinality?: 'many';
          source?: 'provider';
      }
    | {
          argument: ExecutableAppActionDerivedMutationIdentityArgument;
          cardinality?: 'many';
          source: 'app-derived';
          targetCapabilities: readonly ExecutableAppActionParentTrackTargetCapability[];
      };

export type ExecutableAppActionMutationIdentityRule = {
    arguments: readonly ExecutableAppActionMutationIdentityArgument[];
    destructive?: false;
    fallbackArguments?: readonly ExecutableAppActionMutationIdentityArgument[];
    resourceFamily?: string;
    resourceReferenceOnly?: true;
};

export type ExecutableAppActionValueRule =
    | {
          argument: string;
          kind: 'boolean-intent';
          truePhrases: readonly string[];
          falsePhrases: readonly string[];
      }
    | { argument: string; kind: 'text-after-connector'; connector: 'to' }
    | {
          argument: string;
          kind: 'number-if-present';
          defaultWhenUnmentioned?: number;
          requiredInPrompt?: boolean;
          mayOmitWhenUnmentioned?: boolean;
          match?: 'exact';
          connector?: 'from' | 'to' | 'beat';
          keywords?: readonly string[];
          scale?: 'unit-interval' | 'percentage-only' | 'automation-lane-range';
          levelForm?: 'linear' | 'absolute-decibel' | 'relative-decibel';
          direction?: 'pan' | 'vertical-zoom';
          qualitativeDirection?: 'track-gain' | 'track-pan' | 'device-parameter';
          unit?: 'beat-duration' | 'stretch-ratio';
          descriptorUnitSource?: {
              deviceIdArgument: string;
              paramIdArgument: string;
          };
      }
    | { argument: string; kind: 'string-literal' }
    | { argument: string; kind: 'marker-name' }
    | { argument: string; kind: 'marker-reference' }
    | { argument: string; kind: 'marker-beat' }
    | { argument: string; kind: 'marker-color'; values: readonly string[] }
    | { argument: string; kind: 'section-start-beat' }
    | { argument: string; kind: 'section-end-beat' }
    | { argument: string; kind: 'section-name' }
    | { argument: string; kind: 'section-reference' }
    | { argument: string; kind: 'section-new-name' }
    | {
          argument: string;
          kind: 'enum-if-present';
          values: readonly string[];
          aliases?: Readonly<Record<string, readonly string[]>>;
          requiredInPrompt?: boolean;
          defaultWhenUnmentioned?: string;
          mayOmitWhenUnmentioned?: boolean;
      }
    | {
          argument: string;
          kind: 'text-after-keyword-if-present';
          keywords: readonly string[];
          requiredInPrompt?: boolean;
          terminators?: readonly string[];
      }
    | { argument: string; denominatorArgument: string; kind: 'time-signature' };

export type ExecutableAppActionDirectionalIntent = {
    carrierPhrases: readonly string[];
    truePhrases: readonly string[];
    falsePhrases: readonly string[];
};

export type ExecutableAppActionDiscoverability = 'hidden' | 'visible';

export type ExecutableAppActionDescriptor = {
    actionType: AppActionType;
    operationVersion?: number;
    risk: ExecutableAppActionRisk;
    description: string;
    discoverability?: ExecutableAppActionDiscoverability;
    intentPhrases: readonly string[];
    /**
     * Phrases that name this action only in a clause stating a decibel figure in a form one of its
     * level value rules declares. A bare verb such as "put" says nothing about level on its own;
     * "put the Kick at -6 dB" does.
     */
    levelIntentPhrases?: readonly string[];
    /**
     * Level phrases that name the project object they act on with the `{reference}` placeholder:
     * "set {reference} to" names this action in "set Drums to -6 dB", and "{reference} up" in
     * "Drums up 2 dB". Like {@link levelIntentPhrases} they count only in a clause stating a decibel
     * figure in a form one of its level value rules declares, and the placeholder stands for exactly
     * one project reference, so "set Drums Reverb to -6 dB" and "set to -6 dB" name nothing. A phrase
     * opening with the placeholder names the action only at the start of the clause.
     */
    referencedLevelIntentPhrases?: readonly string[];
    selectionPhrases?: readonly string[];
    directionalIntent?: ExecutableAppActionDirectionalIntent;
    targetRules: readonly ExecutableAppActionTargetRule[];
    valueRules?: readonly ExecutableAppActionValueRule[];
    materializedArgumentsValidation?: 'owner-required';
    parameters: {
        properties: Record<string, unknown>;
        required: readonly string[];
    };
};

export const trackTargetRules = [
    { argument: 'trackId', capability: 'track' },
] as const satisfies readonly ExecutableAppActionTargetRule[];

export const existingTrackTargetRules = [
    { argument: 'trackId', capability: 'track', allowBatchLocal: false },
] as const satisfies readonly ExecutableAppActionTargetRule[];

export const SINGLETON_MUTATION_IDENTITY = [{ arguments: [] }] as const;
export const TRACK_MUTATION_IDENTITY = [{ arguments: [{ argument: 'trackId' }], resourceFamily: 'track' }] as const;
