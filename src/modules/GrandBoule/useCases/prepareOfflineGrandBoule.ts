import { createDefaultMorphState } from '../models/GrandBouleMorphState';
import { projectGrandBouleMorphState } from '../models/projectGrandBouleMorphState';
import { createGrandBouleStore } from '../stores/grandBouleStore';

import { hydrateGrandBouleMorphStateFromProject } from './hydrateGrandBouleMorphStateFromProject';

export function prepareOfflineGrandBoule({ deviceId, port }: { deviceId: string; port: MessagePort }): void {
    const morph =
        hydrateGrandBouleMorphStateFromProject(deviceId) ??
        createGrandBouleStore(deviceId).value?.morph ??
        createDefaultMorphState();
    for (const parameter of projectGrandBouleMorphState(morph)) {
        port.postMessage({ type: 'param', ...parameter });
    }
}
