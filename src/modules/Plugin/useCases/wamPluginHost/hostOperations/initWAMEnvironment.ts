let groupCounter = 0;

export async function initWAMEnvironment(context: AudioContext): Promise<string> {
    const groupId = `wam-group-${++groupCounter}`;
    (context as unknown as Record<string, unknown>).__wamGroupId = groupId;
    return groupId;
}