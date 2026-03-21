import { type ReactElement, useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '#/components/ui/dialog';
import { Button } from '#/components/ui/button';
import { Loader2, Sparkles, GraduationCap } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { mixHealthAnalysis } from '#/modules/AiRuntime/useCases/mixHealthAnalysis';
import { streamCloudChatCompletion } from '#/modules/AiRuntime/repositories/cloudLlmRepository';

type MixHealthDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
};

export const MixHealthDialog = ({ open, onOpenChange }: MixHealthDialogProps): ReactElement => {
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [report, setReport] = useState('');
    const reportRef = useRef('');

    useEffect(() => {
        if (open) {
            setReport('');
            reportRef.current = '';
            setIsAnalyzing(true);

            const runAnalysis = async () => {
                try {
                    await mixHealthAnalysis((token) => {
                        reportRef.current += token;
                        setReport(reportRef.current);
                    });
                } catch (error) {
                    console.error(error);
                    setReport('Error generating mix health report. Make sure Cloud AI is connected.');
                } finally {
                    setIsAnalyzing(false);
                }
            };

            void runAnalysis();
        } else {
            setReport('');
        }
    }, [open]);

    const handleELI5 = async () => {
        if (isAnalyzing || !report) {
            return;
        }

        setIsAnalyzing(true);
        const originalReport = report;
        reportRef.current = `${report}\n\n---\n\n### ELI5 Translation\n\n`;
        setReport(reportRef.current);

        try {
            await streamCloudChatCompletion(
                [
                    { role: 'system', content: 'You are a patient music teacher for beginners.' },
                    {
                        role: 'user',
                        content: `Here is a technical mix analysis:\n\n${originalReport}\n\nPlease explain this to me like I am a 5 year old beginner. Focus entirely on simple analogies.`,
                    },
                ],
                (token) => {
                    reportRef.current += token;
                    setReport(reportRef.current);
                }
            );
        } catch (error) {
            console.error(error);
            reportRef.current += '\n[Error generating ELI5 explanation]';
            setReport(reportRef.current);
        } finally {
            setIsAnalyzing(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl bg-surface-raised border border-border/50 text-foreground">
                <DialogHeader>
                    <DialogTitle className="text-sm font-semibold flex items-center gap-2">
                        <Sparkles className="size-4 text-purple-400" />
                        AI Music Mentor: Mix Health
                    </DialogTitle>
                </DialogHeader>

                <div className="min-h-[200px] max-h-[500px] overflow-y-auto space-y-4 text-sm leading-relaxed p-2">
                    {report ? (
                        <div className="prose prose-invert prose-sm max-w-none">
                            <ReactMarkdown>{report}</ReactMarkdown>
                        </div>
                    ) : null}

                    {isAnalyzing && (
                        <div className="flex items-center gap-2 text-muted-foreground pt-4">
                            <Loader2 className="size-4 animate-spin" />
                            <span>Mentor is thinking...</span>
                        </div>
                    )}
                </div>

                <div className="flex justify-between items-center pt-2 border-t border-border/50">
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={handleELI5}
                        disabled={isAnalyzing || !report}
                        className="bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 border-purple-500/20"
                    >
                        <GraduationCap className="size-4 mr-2" />
                        Explain Like I'm 5
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                        Close
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
};
