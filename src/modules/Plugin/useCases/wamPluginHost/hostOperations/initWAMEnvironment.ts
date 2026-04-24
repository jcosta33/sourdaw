// eslint-disable-next-line @typescript-eslint/require-await -- async API contract; callers void-discard but signature must stay async for WAM host protocol
export async function initWAMEnvironment(context: AudioContext): Promise<string> {
    const groupId = `wam-group-${crypto.randomUUID()}`;
    // eslint-disable-next-line sourdaw/no-type-assertion-escape -- AudioContext has no index signature; cast required to set non-standard WAM group property
    (context as unknown as Record<string, unknown>).__wamGroupId = groupId;
    return groupId;
}
