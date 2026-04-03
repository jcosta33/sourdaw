import * as Sentry from '@sentry/react';

Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    enabled: import.meta.env.PROD,
    release: `sourdaw@${__APP_VERSION__}`,
    tracesSampleRate: 0,
    sendDefaultPii: false,
    ignoreErrors: [
        'ResizeObserver loop limit exceeded',
        'ResizeObserver loop completed with undelivered notifications',
    ],
    beforeSend(event) {
        // Strip local file paths that may contain project/user names
        const sanitise = (s: string): string =>
            s.replace(/\/Users\/[^/]+/g, '/Users/[user]').replace(/\/home\/[^/]+/g, '/home/[user]');

        if (event.exception?.values) {
            for (const ex of event.exception.values) {
                if (ex.stacktrace?.frames) {
                    for (const frame of ex.stacktrace.frames) {
                        if (frame.filename) {
                            frame.filename = sanitise(frame.filename);
                        }
                    }
                }
            }
        }

        return event;
    },
});

Sentry.setTag('platform', 'tauri');
