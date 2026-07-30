import { beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '#/infra/logger/appLogger';

import { reportStartupFailure } from '../reportStartupFailure';

describe('reportStartupFailure', () => {
    beforeEach(() => {
        document.body.innerHTML = '<div id="root"></div>';
    });

    it('logs the startup error and replaces the blank root with a fatal alert', () => {
        const logError = vi.spyOn(logger, 'error').mockImplementation(() => {});

        reportStartupFailure('chunk load failed');

        expect(logError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Sourdaw failed to start' }));
        expect(document.getElementById('root')).toHaveTextContent(
            'Sourdaw failed to start. Reload the page to try again.'
        );
        expect(document.querySelector('[role="alert"]')).not.toBeNull();
    });
});
