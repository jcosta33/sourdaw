import { isDesktopRuntime, desktopInvoke } from '#/utils/desktopBridge';

export async function crumbsNoteOn(instanceId: string, note: number, velocity: number): Promise<number | undefined> {
    if (!isDesktopRuntime()) {
        return undefined;
    }
    const receipt = await desktopInvoke('crumbs_pad_audition_on', { instanceId, note, velocity });
    if (typeof receipt !== 'number' || !Number.isSafeInteger(receipt) || receipt <= 0 || receipt > 0xffff_ffff) {
        throw new Error('Invalid Crumbs audition receipt');
    }
    return receipt;
}
