import { readGrandBouleMorphState } from '../models/GrandBouleDeviceState';
import { projectGrandBouleMorphState } from '../models/ProjectGrandBouleMorphState';

export function prepareOfflineGrandBoule({ deviceState, port }: { deviceState: unknown; port: MessagePort }): void {
    const morph = readGrandBouleMorphState(deviceState);
    for (const parameter of projectGrandBouleMorphState(morph)) {
        port.postMessage({ type: 'param', ...parameter });
    }
}
