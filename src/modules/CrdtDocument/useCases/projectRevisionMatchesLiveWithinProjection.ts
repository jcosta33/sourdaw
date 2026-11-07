import { rootRevisionMatching } from './projectRevisionMatchesLiveIgnoringCommandCheckpoint';

/** Authenticate an owner's read-only source projection across every intervening root change. */
export function projectRevisionMatchesLiveWithinProjection(
    revision: string,
    project: (document: Readonly<Record<string, unknown>>) => Record<string, unknown>
): boolean {
    return rootRevisionMatching.matchesLiveWithin(revision, project);
}
