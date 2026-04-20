import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { FolderTree } from '../FolderTree';

describe('FolderTree', () => {
    it('should render', () => {
        const nodes = [
            {
                name: 'Samples',
                path: '/samples',
                fileCount: 3,
                expanded: false,
                children: [],
            },
        ];
        render(<FolderTree nodes={nodes} currentFolder={null} onFolderSelect={vi.fn()} onToggleExpand={vi.fn()} />);
        expect(screen.getByText('Samples')).toBeInTheDocument();
    });
});
