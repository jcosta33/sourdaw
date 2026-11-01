/**
 * Stacking layer of every dialog-service surface (toast, confirmation, prompt).
 *
 * They are the app's only channels for telling and asking the user, so a
 * question asked while a full-screen surface is up (the launch screen and
 * loading overlay at `z-[9999]`, the load-failure overlay and onboarding tour
 * at `z-[10000]`) must paint above it, or its caller waits on an answer the
 * user cannot see. This is the highest of those layers; the confirmation and
 * prompt portal into `document.body` after the app root, so they also win the
 * tie with the surfaces at the same value.
 */
export const DIALOG_SERVICE_LAYER = 'z-[10000]';
