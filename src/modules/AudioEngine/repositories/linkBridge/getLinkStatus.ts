import { LinkStatus, invokeLink } from './helpers';

export async function getLinkStatus(): Promise<LinkStatus> {
    return (await invokeLink('get_link_status')) as LinkStatus;
}