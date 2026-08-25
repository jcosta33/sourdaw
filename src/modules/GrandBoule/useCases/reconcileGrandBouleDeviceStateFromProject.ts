import { applyGrandBouleMorphState } from './applyGrandBouleMorphState';
import { hydrateGrandBouleMorphStateFromProject } from './hydrateGrandBouleMorphStateFromProject';
import { resolveGrandBouleEngine } from './resolveGrandBouleEngine';

/** Apply authoritative project state to session state and a ready live engine. */
export function reconcileGrandBouleDeviceStateFromProject(deviceId: string): void {
    const morph = hydrateGrandBouleMorphStateFromProject(deviceId);
    if (morph === null) {
        return;
    }
    const engine = resolveGrandBouleEngine({ deviceId });
    if (engine.isReady()) {
        applyGrandBouleMorphState(engine, morph);
    }
}
