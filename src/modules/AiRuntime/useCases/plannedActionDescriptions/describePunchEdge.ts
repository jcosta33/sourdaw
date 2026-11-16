import { createPunchRegionPatch } from '#/modules/Transport/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { type ProjectContext } from '../../models/ProjectContext';

/** The punch edge move, or `null` when the region would not change. */
export function describePunchEdge(
    action: Extract<AppAction, { type: 'setPunchIn' | 'setPunchOut' }>,
    context: ProjectContext,
    edge: 'in' | 'out'
): string | null {
    const current = { punchInBeat: context.punchInBeat, punchOutBeat: context.punchOutBeat };
    const patch = createPunchRegionPatch({ current, beat: action.payload.beat, edge });
    if (patch === null) {
        return null;
    }
    const next = { ...current, ...patch };
    const enabledState = context.punchInEnabled ? 'enabled' : 'disabled';
    if (edge === 'in') {
        let oppositeChange = `punch-out remains at beat ${String(current.punchOutBeat)}`;
        if (next.punchOutBeat !== current.punchOutBeat) {
            oppositeChange = `punch-out moves from beat ${String(current.punchOutBeat)} to ${String(next.punchOutBeat)}`;
        }
        return `Set punch-in to beat ${String(action.payload.beat)}; ${oppositeChange}; resulting region ${String(next.punchInBeat)}–${String(next.punchOutBeat)}; punch recording remains ${enabledState}`;
    }

    let oppositeChange = `punch-in remains at beat ${String(current.punchInBeat)}`;
    if (next.punchInBeat !== current.punchInBeat) {
        oppositeChange = `punch-in moves from beat ${String(current.punchInBeat)} to ${String(next.punchInBeat)}`;
    }
    return `Set punch-out to beat ${String(action.payload.beat)}; ${oppositeChange}; resulting region ${String(next.punchInBeat)}–${String(next.punchOutBeat)}; punch recording remains ${enabledState}`;
}
