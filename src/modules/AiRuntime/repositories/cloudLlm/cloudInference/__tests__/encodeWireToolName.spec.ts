import { describe, expect, it } from 'vitest';

import { encodeWireToolName } from '../encodeWireToolName';

describe('encodeWireToolName', () => {
    it('replaces every dot with an underscore', () => {
        expect(encodeWireToolName('project.query')).toBe('project_query');
        expect(encodeWireToolName('agent.catalog.discover')).toBe('agent_catalog_discover');
    });

    it('leaves a name without dots unchanged', () => {
        expect(encodeWireToolName('muteTrack')).toBe('muteTrack');
    });
});
