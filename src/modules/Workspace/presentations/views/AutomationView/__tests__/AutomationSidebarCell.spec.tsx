import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { AutomationSidebarCell } from '../AutomationSidebarCell';

describe('AutomationSidebarCell', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<AutomationSidebarCell>cell</AutomationSidebarCell>);
        expect(document.body).toBeTruthy();
    });
});
