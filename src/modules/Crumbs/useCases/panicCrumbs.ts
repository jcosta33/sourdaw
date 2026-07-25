import { crumbsAllSoundOff } from '../repositories/crumbsBridge/crumbsAllSoundOff';
import { crumbsStore } from '../stores/crumbsStore';

/**
 * Silence every live Crumbs instance (audit MD-6).
 *
 * Crumbs voices are held by the native engine, not the Web Audio graph, so the
 * engine-wide stop sweep cannot reach them — a pad triggered from the panel and
 * never released keeps sounding through transport stop. The `AllSoundOff`
 * command has existed on the Rust side the whole time with no caller.
 */
export async function panicCrumbs(): Promise<void> {
    const instances = crumbsStore.value;
    if (!instances) {
        return;
    }
    await Promise.all(Object.keys(instances).map((instanceId) => crumbsAllSoundOff(instanceId)));
}
