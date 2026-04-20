import { invokeLink } from './helpers';

export async function disableLink(): Promise<void> {
    await invokeLink('disable_link');
}
