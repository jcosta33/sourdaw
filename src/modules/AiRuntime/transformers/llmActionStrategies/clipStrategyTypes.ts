import { type ProjectContext } from '../../models/ProjectContext';
import { type RuntimeAction, type RuntimeActionType } from '../../models/RuntimeAction';
import { type LlmActionRejection } from '../llmActionBridgeContracts';
import { type ToolCallResult } from '../toolCallParser';

// `duplicateClip` shares its original bridge branch with `duplicateClipToNextBar` — the two
// names were checked in one `call.name === 'duplicateClip' || call.name === 'duplicateClipToNextBar'`
// guard with an identical body. Splitting that guard across two files would either duplicate the
// guard or leave one name unreachable, so both travel together into this registry.
export const clipActionNames = [
    'addClip',
    'moveClip',
    'duplicateClipAt',
    'drawClip',
    'moveClips',
    'splitClip',
    'duplicateClip',
    'duplicateClipToNextBar',
    'normalizeClip',
    'setClipStretchRatio',
    'setClipStretchMode',
    'fitClipToBeats',
    'removeClip',
    'renameClip',
    'trimClipStart',
    'trimClipEnd',
    'nudgeClip',
    'slipClipContent',
    'setClipGain',
    'muteClip',
    'setClipColor',
    'setClipFade',
    'glueClips',
    'crossfadeClips',
    'lockClip',
    'setClipLoop',
    'setClipLoopLength',
] as const satisfies readonly Extract<RuntimeActionType, string>[];

export type ClipCallName = (typeof clipActionNames)[number];

export type ClipStrategyInput = {
    call: ToolCallResult;
    context: ProjectContext;
    index: number;
};

export type ClipStrategy<Name extends ClipCallName> = (
    input: ClipStrategyInput
) => Extract<RuntimeAction, { type: Name }> | LlmActionRejection;

export type ClipStrategyDefinition<Name extends ClipCallName> = {
    [StrategyName in Name]: {
        name: StrategyName;
        transform: ClipStrategy<StrategyName>;
    };
}[Name];
