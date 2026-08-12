import { pushStore } from '../../stores/push';

const DISPLAY_LINE_COUNT = 4;

export function updateDisplay(lineIndex: number, text: string): void {
    const state = pushStore.value;
    if (!state) {
        return;
    }
    if (!Number.isInteger(lineIndex) || lineIndex < 0 || lineIndex >= DISPLAY_LINE_COUNT) {
        return;
    }
    const lines = [...state.display.lines] as [string, string, string, string];
    lines[lineIndex] = text.slice(0, 68);
    pushStore.set({ ...state, display: { lines } });
}
