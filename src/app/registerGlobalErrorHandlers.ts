import type { Logger } from '#/infra/logger/types';

type RegisterGlobalErrorHandlersInput = {
    logger: Logger;
};

/**
 * Register process-wide handlers for otherwise-silent async failures.
 *
 * A fire-and-forget promise that rejects with no local `.catch` dies without a
 * trace; nothing in the app owns the `unhandledrejection` event. This funnels
 * those rejections into the app logger so they surface in dev tools and any
 * attached log sink instead of vanishing.
 *
 * Returns a disposer that removes the listener — used for HMR teardown so a
 * hot module replacement does not stack duplicate handlers.
 */
export function registerGlobalErrorHandlers({ logger }: RegisterGlobalErrorHandlersInput): () => void {
    const handleUnhandledRejection = (event: PromiseRejectionEvent): void => {
        logger.error(new Error('Unhandled promise rejection', { cause: event.reason }));
    };

    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
        window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
}
