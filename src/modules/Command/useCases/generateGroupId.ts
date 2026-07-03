export function generateGroupId(label: string): { groupId: string; groupLabel: string } {
    return {
        groupId: `group-${crypto.randomUUID().slice(0, 8)}`,
        groupLabel: label,
    };
}
