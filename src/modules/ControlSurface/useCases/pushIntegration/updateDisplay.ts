import { pushStore } from '../../stores/push';

export function updateDisplay(lineIndex: number, text: string): void {
    const state = pushStore.value;
    if (!state) {
        return;
    }
    const lines = [...state.display.lines] as [string, string, string, string];
    lines[lineIndex] = text.slice(0, 68);
    pushStore.set({ ...state, display: { lines } });
}
