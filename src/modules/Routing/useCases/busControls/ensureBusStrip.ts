import { ensureBusStrip as ensureBusStripEngine } from '#/modules/AudioEngine/useCases';

export function ensureBusStrip(busId: string): void {
    ensureBusStripEngine(busId);
}