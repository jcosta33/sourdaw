import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type PreviewHandle } from '../../../hooks/usePreviewAudio';
import { OnlineSampleBrowser } from '../OnlineSampleBrowser';

const createPreview = (): PreviewHandle => ({
    playingId: null,
    play: vi.fn<PreviewHandle['play']>(),
    playTone: vi.fn<PreviewHandle['playTone']>(),
    playFile: vi.fn<PreviewHandle['playFile']>().mockResolvedValue(undefined),
    stop: vi.fn<PreviewHandle['stop']>(),
});

describe('OnlineSampleBrowser', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<OnlineSampleBrowser preview={createPreview()} />);
        expect(document.body).toBeTruthy();
    });
});
