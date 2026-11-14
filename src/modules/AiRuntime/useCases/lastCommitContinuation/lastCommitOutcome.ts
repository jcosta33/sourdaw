import { type AdoptedRecipe } from '../../models/AdoptedRecipe';
import { type LastCommitRefusal } from '../../models/LastCommitRefusal';
import { type RuntimeAction } from '../../models/RuntimeAction';
import { type LastCommitRequest } from '../../transformers/readLastCommitRequest';
import { type groundApplicationRecipeBatch } from '../groundApplicationRecipeBatch';

type GroundedRecipeBatch = Extract<ReturnType<typeof groundApplicationRecipeBatch>, { status: 'grounded' }>;

/**
 * What the planner makes of a chat request that continues, undoes or re-targets the thread's last
 * commit: `none` when the request is no such thing (or a pending card owns it), and it is planned as
 * any request; otherwise the application compiles the outcome itself from the committed batch, or,
 * for a commit that adopted a recipe, re-expands that recipe on the tracks the request names.
 */
export type LastCommitContinuation =
    | { status: 'none' }
    | { status: 'actions'; actions: RuntimeAction[]; continuedFigures?: ContinuedFigure[] }
    | {
          status: 'recipe';
          grounded: GroundedRecipeBatch['grounded'];
          adoptedRecipes: AdoptedRecipe[];
          creativeAuthority: GroundedRecipeBatch['creativeAuthority'];
      }
    | { status: 'revert'; runId: string; revertGroupId: string }
    | LastCommitRefusal;

/**
 * A device parameter value a continuation compiled from the request's figure: the planner accounts
 * the figure against the action that sets `landed`, the committed value moved by it.
 */
export type ContinuedFigure = {
    deviceId: string;
    paramId: string;
    unit: string;
    figure: number;
    comparative: 'more' | 'less';
    committed: number;
    landed: number;
};

export type ContinueRequest = Extract<LastCommitRequest, { kind: 'continue' }>;

export type RetargetRequest = Extract<LastCommitRequest, { kind: 'retarget' }>;

/** One command of the committed batch, as the undo history holds it applied. */
export type CommittedCommand = { type: string; payload: Record<string, unknown>; label: string };

export type CommittedBatch = { runId: string; workId: string; revertGroupId: string; commands: CommittedCommand[] };
