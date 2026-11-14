// Command-owned effect metadata: `dimensions` names what the production handler and its writer
// actually mutate, traced through that handler, not what the request implies. `scope` names how far
// the write or audible change reaches beyond the named target. `conditional` entries name writes that
// depend on live runtime state at execution time and therefore need an execution-time policy, not a request-time check.

export type ExecutableAppActionEffectDimension =
    | 'processing'
    | 'midi-content'
    | 'clip-audio'
    | 'arrangement'
    | 'routing'
    | 'project-timing'
    | 'transport'
    | 'master'
    | 'monitoring'
    | 'automation'
    | 'external'
    | 'branching'
    | 'cosmetic'
    | 'protection';

export type ExecutableAppActionEffectCondition =
    | 'transport-playing-in-recording-mode'
    | 'folder-strip-activation'
    | 'midi-clip'
    | 'midi-track-kind'
    | 'recording-in-progress'
    | 'repitch-stretch-mode';

export type ExecutableAppActionEffectScope = 'target' | 'descendants' | 'siblings' | 'dependents' | 'project';

export type ExecutableAppActionEffectObject =
    | 'track'
    | 'bus'
    | 'clip'
    | 'notes'
    | 'device'
    | 'send'
    | 'sidechain-route'
    | 'automation-lane'
    | 'automation-point'
    | 'adjustment-region'
    | 'marker'
    | 'section'
    | 'vca-group'
    | 'branch'
    | 'render-artifact'
    | 'groove-template';

export type ExecutableAppActionNoteField = 'pitch' | 'startBeat' | 'duration' | 'velocity' | 'articulation';

export type ExecutableAppActionEffect = {
    dimensions: readonly ExecutableAppActionEffectDimension[];
    conditional?: readonly {
        dimension: ExecutableAppActionEffectDimension;
        when: ExecutableAppActionEffectCondition;
    }[];
    scope: ExecutableAppActionEffectScope;
    creates?: readonly ExecutableAppActionEffectObject[];
    removes?: readonly ExecutableAppActionEffectObject[];
    noteFields?: readonly ExecutableAppActionNoteField[];
};
