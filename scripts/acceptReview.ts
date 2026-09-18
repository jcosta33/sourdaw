import { authenticateOrchestrator } from './githubAppIdentity.ts';
import { fail } from './prContract.ts';
import {
    coordinateOrchestratorAcceptance,
    defaultPublishReviewCoordinatorDependencies,
    parsePublishReviewArgs,
    publishPreparedAcceptance,
    type AcceptReviewCoordinatorDependencies,
} from './publishReview.ts';

export function defaultAcceptReviewCoordinatorDependencies(): AcceptReviewCoordinatorDependencies {
    const { authenticateReviewer: _authenticateReviewer, ...shared } = defaultPublishReviewCoordinatorDependencies();
    return { ...shared, authenticateOrchestrator, publish: publishPreparedAcceptance };
}

export async function coordinateAcceptReview(
    number: number,
    dependencies: AcceptReviewCoordinatorDependencies = defaultAcceptReviewCoordinatorDependencies()
): Promise<void> {
    return coordinateOrchestratorAcceptance(number, dependencies);
}

export async function runAcceptReviewCli(
    args: string[],
    dependencies?: AcceptReviewCoordinatorDependencies
): Promise<number> {
    const parsed = parsePublishReviewArgs(args, 'review:accept');
    if (parsed.help) {
        console.log('usage: pnpm review:accept <pr-number>');
        return 0;
    }
    if (parsed.number === undefined) {
        fail('missing pull-request number');
    }
    await coordinateAcceptReview(parsed.number, dependencies);
    return 0;
}
