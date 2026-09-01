import { cloudSession } from './cloudSession';
import { inFlightCloudConnect } from './inFlightCloudConnect';

export async function clearCloudProviderConfig(): Promise<void> {
    inFlightCloudConnect.supersede();
    await cloudSession.clear();
}
