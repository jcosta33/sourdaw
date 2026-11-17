import { type EditMidiNotesPayload } from '#/modules/MIDI/events';
import { type AppAction } from '#/utils/handlerContract';

import {
    type ProjectContext,
    type ProjectContextAdjustmentLayer,
    type ProjectContextTrack,
} from '../../models/ProjectContext';
import { type BassProcessingCopyRequestScope } from '../agentReference/getBassProcessingCopyPromptScope';
import { type DrumPreviewBranchesRequestScope } from '../agentReference/getDrumPreviewBranchesPromptScope';
import { type MidiOverlapTransformRequestScope } from '../agentReference/getMidiOverlapTransformPromptScope';
import { type SyncopatedArpeggioRequestScope } from '../agentReference/getSyncopatedArpeggioPromptScope';

export type MaterializeActionStateGuardsOptions = {
    appOwnedRenderTailSeconds?: number;
    bassProcessingCopyScope?: BassProcessingCopyRequestScope;
    midiOverlapTransformScope?: MidiOverlapTransformRequestScope;
    midiNoteEdit?: { clipId: string; guard: EditMidiNotesPayload['guard'] };
    drumPreviewBranchesScope?: DrumPreviewBranchesRequestScope;
    syncopatedArpeggioScope?: SyncopatedArpeggioRequestScope;
};

/**
 * What the materialization of one action reads and updates: the project as the batch has projected
 * it so far. Every map is shared by the whole batch, so an action sees what the earlier ones made.
 */
export type MaterializationState = {
    context: ProjectContext;
    options: MaterializeActionStateGuardsOptions;
    tracksById: Map<string, ProjectContextTrack>;
    frozenByTrack: Map<string, boolean | undefined>;
    reservedDeviceIds: Set<string>;
    reservedAdjustmentRegionIds: Set<string>;
    projectedAdjustmentLayers: Map<string, ProjectContextAdjustmentLayer>;
    deviceIdsByTrack: Map<string, string[]>;
};

/**
 * One action's outcome: the actions it materializes into, or a rejection. A rejection carries
 * `questions` only when the request is answerable but names its target ambiguously — two sections
 * matching a reference equally — so the planner can ask which one instead of refusing.
 */
export type MaterializationStep =
    | { status: 'accepted'; actions: AppAction[] }
    | { status: 'rejected'; reason: string; questions?: readonly string[] };
