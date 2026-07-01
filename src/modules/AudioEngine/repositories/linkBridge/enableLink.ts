import { type LinkStatus } from './helpers';
import { invokeLink } from './invokeLink';

export async function enableLink(): Promise<LinkStatus> {
    return (await invokeLink('enable_link')) as LinkStatus;
}
