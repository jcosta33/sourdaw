import { setCrustUiLevel } from '../stores/crustStore';

export function setCrustPanelUiLevel(level: 1 | 2 | 3 | 4 | 5): void {
    setCrustUiLevel(level);
}
