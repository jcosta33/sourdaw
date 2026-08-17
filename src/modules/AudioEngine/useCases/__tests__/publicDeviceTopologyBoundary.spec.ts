import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const modulesDirectory = join(testDirectory, '..', '..', '..');
const audioEngineUseCases = readFileSync(join(testDirectory, '..', 'index.ts'), 'utf8');
const audioEngineContract = readFileSync(
    join(modulesDirectory, 'AudioEngine', 'models', 'AudioEngineState.ts'),
    'utf8'
);
const instrumentsTab = readFileSync(
    join(modulesDirectory, 'ContentBrowser', 'presentations', 'views', 'Sidebar', 'InstrumentsTab.tsx'),
    'utf8'
);
const nebulaDriftDemo = readFileSync(
    join(modulesDirectory, 'Project', 'useCases', 'demoProjects', 'nebulaDrift', 'createNebulaDriftDemo.ts'),
    'utf8'
);

describe('public device topology boundary', () => {
    it('does not expose raw topology device writers through the engine contract', () => {
        expect(audioEngineUseCases).not.toMatch(/export \{ addDeviceToStrip \}/);
        expect(audioEngineUseCases).not.toMatch(/export \{ removeDeviceFromStrip \}/);
        expect(audioEngineContract).not.toContain('addDeviceToStrip');
        expect(audioEngineContract).not.toContain('removeDeviceFromStrip');
        expect(existsSync(join(testDirectory, '..', 'deviceControls', 'addDeviceToStrip.ts'))).toBe(false);
        expect(existsSync(join(testDirectory, '..', 'deviceControls', 'removeDeviceFromStrip.ts'))).toBe(false);
    });

    it('routes Toaster and Grand Boule cards through compiled preset actions', () => {
        expect(instrumentsTab).not.toContain('createDrumTrackStack');
        expect(instrumentsTab).not.toContain('createGrandBouleTrack');
        expect(instrumentsTab).toContain('compileToasterTrackStackActions');
        expect(instrumentsTab).toContain("executeCatalogPreset('grand-boule-default')");
    });

    it('rehydrates the demo Toaster through the validated snapshot boundary', () => {
        expect(nebulaDriftDemo).not.toContain('addDeviceToStrip');
        expect(nebulaDriftDemo).toContain('projectTrackToLiveStrip');
    });
});
