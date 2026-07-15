import { isTauri } from '#/utils/tauriBridge';

export function ensureTauri(command: string): void {
    if (!isTauri()) {
        throw new Error(`Crumbs IPC "${command}" is only available in the Sourdaw desktop app`);
    }
}
