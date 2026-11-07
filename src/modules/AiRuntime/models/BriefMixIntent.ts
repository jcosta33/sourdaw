import { type getMixRecipeCatalog } from '#/modules/Arrangement/useCases';

export type BriefMixIntent = {
    catalogId: string;
    requestedDescriptors: readonly ReturnType<typeof getMixRecipeCatalog>['descriptors'][number][];
};
