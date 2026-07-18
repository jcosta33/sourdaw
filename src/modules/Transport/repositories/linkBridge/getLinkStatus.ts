import { type LinkStatus } from './helpers';
import { invokeLink } from './invokeLink';

export async function getLinkStatus(): Promise<LinkStatus> {
    return (await invokeLink('get_link_status')) as LinkStatus;
}
