import { generateGroupId as createGroupId } from '../models/UndoEntry';

export function generateGroupId(label: string): { groupId: string; groupLabel: string } {
    return createGroupId(label);
}
