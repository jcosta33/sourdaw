import { describe, expect, it } from 'vitest';

import type { SourdawBridge } from '../../../electron/channels';

/**
 * Compile-time pin: the ambient `SourdawDesktopBridge` declaration
 * (`src/types/sourdaw-desktop.d.ts`) and the preload contract
 * (`electron/channels.ts`) must stay mutually assignable. The renderer build
 * cannot import `electron/**`, so the ambient type is a hand-written mirror —
 * these two identity functions are what fail `pnpm typecheck:test` the moment
 * either side drifts.
 */
const toPreloadContract = (bridge: SourdawDesktopBridge): SourdawBridge => bridge;
const toAmbientDeclaration = (bridge: SourdawBridge): SourdawDesktopBridge => bridge;

describe('sourdaw-desktop.d.ts', () => {
    it('stays assignable to the preload contract in both directions', () => {
        expect(typeof toPreloadContract).toBe('function');
        expect(typeof toAmbientDeclaration).toBe('function');
    });
});
