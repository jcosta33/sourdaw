import { scanAbortControllerState } from './scanAbortControllerState';

export function setScanAbortController(controller: AbortController | null): void {
    scanAbortControllerState.controller = controller;
}
