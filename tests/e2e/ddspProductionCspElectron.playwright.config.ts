import { defineConfig } from '@playwright/test';

// oxlint-disable-next-line import/no-default-export -- Playwright requires this export shape.
export default defineConfig({
    testDir: '.',
    testMatch: 'ddspProductionCspElectron.spec.ts',
    timeout: 120_000,
    fullyParallel: false,
    workers: 1,
    reporter: 'line',
});
