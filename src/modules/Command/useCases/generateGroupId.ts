type GenerateGroupIdOutput = {
    groupId: string;
    groupLabel: string;
};

export function generateGroupId(label: string): GenerateGroupIdOutput {
    return {
        groupId: `group-${crypto.randomUUID().slice(0, 8)}`,
        groupLabel: label,
    };
}
