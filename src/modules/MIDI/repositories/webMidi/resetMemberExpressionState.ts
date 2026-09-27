import { memberExpressionGeneration } from './memberExpressionGeneration';
import { memberExpressionState } from './memberExpressionState';
import { clearPendingMemberAdmissions } from './pendingMemberAdmission';

export function resetMemberExpressionState(): void {
    memberExpressionGeneration.current += 1;
    memberExpressionState.clear();
    clearPendingMemberAdmissions();
}
