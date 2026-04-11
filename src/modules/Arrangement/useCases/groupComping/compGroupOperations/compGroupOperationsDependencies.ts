import {
    groupCompingStore,
    getNextGroupId,
    getNextTakeSetId,
    getNextRegionId,
    GROUP_COLORS,
} from '#/modules/Arrangement/stores/groupComping';

export const compGroupOperationsDependencies = {
    groupCompingStore,
    getNextGroupId,
    getNextTakeSetId,
    getNextRegionId,
    GROUP_COLORS,
} as const;