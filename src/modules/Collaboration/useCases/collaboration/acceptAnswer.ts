import { collaborationSessionRuntime } from './sessionManagement';

export async function acceptAnswer(answerString: string): Promise<void> {
    return collaborationSessionRuntime.acceptAnswer(answerString);
}
