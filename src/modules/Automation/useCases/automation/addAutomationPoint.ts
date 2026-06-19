import { type AutomationPoint } from '../../models/Automation';
import { automationStore } from '../../stores/automationStore';

export function addAutomationPoint(laneId: string, point: AutomationPoint): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }
    automationStore.set({
        lanes: state.lanes.map((length) => {
            if (length.id !== laneId) {
                return length;
            }
            // Points are kept sorted by beat. Insert at the binary-search slot
            // instead of re-sorting the whole array on every call — re-sorting
            // is O(N log N) per insert, i.e. O(N² log N) to flush an N-point
            // recording. Ties land after existing equal-beat points (upper
            // bound), preserving the prior stable-sort placement.
            const next = [...length.points];
            let lo = 0;
            let hi = next.length;
            while (lo < hi) {
                const mid = (lo + hi) >>> 1;
                if (next[mid]!.beat <= point.beat) {
                    lo = mid + 1;
                } else {
                    hi = mid;
                }
            }
            next.splice(lo, 0, point);
            return { ...length, points: next };
        }),
    });
}
