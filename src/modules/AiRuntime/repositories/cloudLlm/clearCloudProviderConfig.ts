import { cloudSession } from './cloudSession';

export async function clearCloudProviderConfig(): Promise<void> {
    await cloudSession.clear();
}
