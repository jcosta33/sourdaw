import { describe, expect, it } from 'vitest';

describe('rippleEditing module initialization', () => {
    it('loads Workspace through an Arrangement consumer without initialization errors', async () => {
        await expect(import('#/modules/Arrangement/presentations/views/TrackListView')).resolves.toBeDefined();
        await expect(import('#/modules/Workspace')).resolves.toBeDefined();
    }, 20_000);
});
