import { advanceSetlistItemEnd } from './advanceSetlistItemEnd';

let observerStarted = false;

export function startSetlistItemEndObserver(): void {
    if (observerStarted) {
        return;
    }
    observerStarted = true;

    const loop = (): void => {
        advanceSetlistItemEnd();
        requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
}
