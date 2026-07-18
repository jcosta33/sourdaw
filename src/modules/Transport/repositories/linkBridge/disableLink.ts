import { invokeLink } from './invokeLink';

export async function disableLink(): Promise<void> {
    await invokeLink('disable_link');
}
