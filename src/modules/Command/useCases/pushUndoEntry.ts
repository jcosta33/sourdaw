// Single source of truth for "build a callback undo entry and commit it" lives in
// the public `stores/pushUndoEntry`. This module re-exports it so the intra-module
// keyboard-shortcut callers (and the tests that mock this path) keep one
// implementation rather than a second, drift-prone copy.
export { pushUndoEntry } from '../stores/pushUndoEntry';
