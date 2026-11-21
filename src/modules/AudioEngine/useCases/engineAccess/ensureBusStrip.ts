import { inject } from '#/infra/di/inject';

import { audioEngine } from '../../repositories/createWebAudioEngine';

// ─── Bus operations ────────────────────────────────────────────────────────────

export const ensureBusStrip = inject({ audioEngine })(
    ({ audioEngine }) =>
        function ensureBusStrip(busId: string): void {
            audioEngine.ensureBusStrip(busId);
        }
);
