import {
    groupCompingStore,
    getNextGroupId,
    getNextTakeSetId,
    getNextRegionId,
    GROUP_COLORS,
} from '../../../stores/groupComping';

export const compGroupOperationsDependencies = {
    groupCompingStore,
    getNextGroupId,
    getNextTakeSetId,
    getNextRegionId,
    GROUP_COLORS,
} as const;
