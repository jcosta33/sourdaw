import { disableLink as disableLinkBridge } from '../../repositories/linkBridge/disableLink';

export async function disableLink(): Promise<void> {
    await disableLinkBridge();
}
