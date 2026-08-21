export type VoicePromptDraftAdmissionPort = {
    readonly isBusy: () => boolean;
    readonly appendDraft: (text: string) => void;
    readonly rejectBusyDraft: () => void;
};

/**
 * The only consumer capability granted to final voice text is appending a
 * draft. Submission, planning, execution, and project mutation remain outside
 * this boundary and require a later explicit user action.
 */
export const createVoicePromptDraftAdmission =
    (port: VoicePromptDraftAdmissionPort) =>
    (text: string): void => {
        if (port.isBusy()) {
            port.rejectBusyDraft();
            return;
        }
        port.appendDraft(text);
    };
