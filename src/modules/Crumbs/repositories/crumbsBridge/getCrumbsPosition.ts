import { ensureTauri } from './helpers';
import { invokeCrumbs } from './invokeCrumbs';

export async function getCrumbsPosition(instanceId: string): Promise<number> {
    ensureTauri('get_crumbs_position');
    const result = await invokeCrumbs('get_crumbs_position', { instanceId });
    return result as number;
}
