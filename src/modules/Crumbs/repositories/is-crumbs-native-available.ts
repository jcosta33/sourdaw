import { isTauri } from '#/utils/tauriBridge';

export function isCrumbsNativeAvailable(): boolean {
    return isTauri();
}
