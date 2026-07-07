import { scanAbortControllerState } from './scanAbortControllerState';

export function getScanAbortController(): AbortController | null {
    return scanAbortControllerState.controller;
}
