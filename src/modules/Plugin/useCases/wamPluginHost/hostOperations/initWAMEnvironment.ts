export async function initWAMEnvironment(context: AudioContext): Promise<string> {
    const groupId = `wam-group-${crypto.randomUUID()}`;
    (context as unknown as Record<string, unknown>).__wamGroupId = groupId;
    return groupId;
}
