import { resetMemberExpressionState } from './resetMemberExpressionState';
import { webMidiRuntime } from './state';

export function setMpeEnabledInternal(enabled: boolean): void {
    if (webMidiRuntime.mpeEnabled !== enabled) {
        resetMemberExpressionState();
    }
    webMidiRuntime.mpeEnabled = enabled;
}
