import { memberExpressionState } from './memberExpressionState';
import { webMidiRuntime } from './state';

export function setMpeEnabledInternal(enabled: boolean): void {
    if (webMidiRuntime.mpeEnabled !== enabled) {
        memberExpressionState.clear();
    }
    webMidiRuntime.mpeEnabled = enabled;
}
