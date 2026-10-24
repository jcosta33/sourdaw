import { type getExecutableAppActionGroundingCatalog } from '#/modules/Command/useCases';

type GroundingCatalog = ReturnType<typeof getExecutableAppActionGroundingCatalog>;

/** The catalog as the clause reader sees it when no referenced level phrase ("set {reference} to") counts. */
export function withoutReferencedLevelPhrases(catalog: GroundingCatalog): GroundingCatalog {
    return catalog.map((entry) =>
        entry.referencedLevelIntentPhrases === undefined ? entry : { ...entry, referencedLevelIntentPhrases: [] }
    );
}
