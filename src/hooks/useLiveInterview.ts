import { useState, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Type } from '@google/genai';
import { AudioRecorder, AudioPlayer } from '../lib/audioUtils';

export interface InterviewReport {
  overall_feedback: string;
  strengths: string[];
  areas_for_improvement: string[];
  emotion_and_body_language: string;
  score: number;
}

interface FinishInterviewArgs {
  overall_feedback?: string;
  strengths?: string[];
  areas_for_improvement?: string[];
  emotion_and_body_language?: string;
  score?: number;
}

export function useLiveInterview(videoRef: React.RefObject<HTMLVideoElement | null>) {
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [report, setReport] = useState<InterviewReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);

  const sessionRef = useRef<any>(null);
  const recorderRef = useRef<AudioRecorder | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);
  const videoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const endTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reportRef = useRef<InterviewReport | null>(null);
  const endRequestedRef = useRef(false);

  const setInterviewReport = useCallback((nextReport: InterviewReport) => {
    reportRef.current = nextReport;
    setReport(nextReport);
  }, []);

  const fallbackReport: InterviewReport = {
    overall_feedback: 'Interview ended before the full report could be generated.',
    strengths: ['You completed a live mock interview session.'],
    areas_for_improvement: ['Try ending after at least a few full responses for a richer report.'],
    emotion_and_body_language: 'The session ended before full body-language analysis could be completed.',
    score: 5,
  };

  const cleanupSession = useCallback((shouldCloseSession: boolean) => {
    if (videoIntervalRef.current) {
      clearInterval(videoIntervalRef.current);
      videoIntervalRef.current = null;
    }

    if (endTimeoutRef.current) {
      clearTimeout(endTimeoutRef.current);
      endTimeoutRef.current = null;
    }

    recorderRef.current?.stop();
    playerRef.current?.stop();
    setLocalStream(null);
    setIsSpeaking(false);

    if (shouldCloseSession && sessionRef.current) {
      try {
        sessionRef.current.close();
      } catch (closeError) {
        console.error('Error while closing live session:', closeError);
      }
    }

    sessionRef.current = null;
    setIsConnected(false);
    setIsConnecting(false);
  }, []);

  const requestInterviewEnd = useCallback((session: any) => {
    endRequestedRef.current = true;

    session.sendRealtimeInput({
      text: 'I would like to end the interview now. Please call the finish_interview_and_report tool to generate my feedback and then conclude the interview.',
    });

    if (endTimeoutRef.current) {
      clearTimeout(endTimeoutRef.current);
    }

    // Fallback so the UI still transitions to the final score page.
    endTimeoutRef.current = setTimeout(() => {
      if (!reportRef.current) {
        setInterviewReport(fallbackReport);
      }
      cleanupSession(true);
    }, 8000);
  }, [cleanupSession, setInterviewReport]);

  const startInterview = useCallback(async (resumeText: string, jobDescription: string) => {
    setIsConnecting(true);
    setError(null);
    setReport(null);
    reportRef.current = null;
    endRequestedRef.current = false;

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      recorderRef.current = new AudioRecorder();
      playerRef.current = new AudioPlayer();

      const systemInstruction = `You are an expert technical and behavioral interviewer. You are conducting a professional mock interview.
      
Job Description:
${jobDescription}

Candidate Resume:
${resumeText}

CRITICAL INSTRUCTIONS:
1. YOU MUST DRIVE THE INTERVIEW. Do not wait for the candidate to ask you to ask a question.
2. Start by greeting the candidate and asking them to introduce themselves.
3. After the candidate answers a question, briefly acknowledge their answer and IMMEDIATELY ask the next relevant question.
4. You are receiving video frames of the candidate. Analyze their facial expressions, eye contact, and body language (e.g., nervous, confident, confused) during the interview.
5. Keep your responses concise and conversational.
6. Once you have asked 5-6 questions and have enough information to evaluate them, OR if the candidate asks to end the interview, call the 'finish_interview_and_report' tool to generate their feedback report.`;

      const finishInterviewTool = {
        functionDeclarations: [
          {
            name: 'finish_interview_and_report',
            description: 'Call this tool when the interview is complete, or when the user explicitly asks to end the interview. Provide detailed feedback based on the candidate\'s answers during the interview.',
            parameters: {
              type: Type.OBJECT,
              properties: {
                overall_feedback: {
                  type: Type.STRING,
                  description: 'A comprehensive summary of the candidate\'s performance.'
                },
                strengths: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: 'List of the candidate\'s key strengths demonstrated during the interview.'
                },
                areas_for_improvement: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: 'List of areas where the candidate could improve.'
                },
                emotion_and_body_language: {
                  type: Type.STRING,
                  description: 'Detailed feedback on the candidate\'s facial expressions, eye contact, and body language based on the video feed.'
                },
                score: {
                  type: Type.NUMBER,
                  description: 'An overall score out of 10 for the interview performance.'
                }
              },
              required: ['overall_feedback', 'strengths', 'areas_for_improvement', 'emotion_and_body_language', 'score']
            }
          }
        ]
      };

      const sessionPromise = ai.live.connect({
        model: "gemini-3.1-flash-live-preview",
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
          },
          systemInstruction,
          tools: [finishInterviewTool],
        },
        callbacks: {
          onopen: () => {
            setIsConnected(true);
            setIsConnecting(false);
            
            recorderRef.current?.start((base64Data) => {
              sessionPromise.then((session) => {
                session.sendRealtimeInput({
                  audio: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
                });
              });
            }).then(stream => {
              setLocalStream(stream);
            }).catch((recorderError) => {
              console.error('Failed to start audio recorder:', recorderError);
              setError('Could not access microphone/camera.');
              cleanupSession(true);
            });

            // Start sending video frames
            videoIntervalRef.current = setInterval(() => {
              if (videoRef.current && videoRef.current.readyState >= 2) {
                const canvas = document.createElement('canvas');
                canvas.width = videoRef.current.videoWidth;
                canvas.height = videoRef.current.videoHeight;
                const ctx = canvas.getContext('2d');
                if (ctx) {
                  ctx.drawImage(videoRef.current, 0, 0);
                  const base64 = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
                  sessionPromise.then(session => {
                    session.sendRealtimeInput({
                      video: { data: base64, mimeType: 'image/jpeg' }
                    });
                  });
                }
              }
            }, 2000); // 1 frame every 2 seconds
          },
          onmessage: async (message: LiveServerMessage) => {
            // Handle audio output
            const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64Audio) {
              setIsSpeaking(true);
              playerRef.current?.playBase64Pcm(base64Audio);
              // Reset speaking state after a short delay (simple heuristic)
              setTimeout(() => setIsSpeaking(false), 500);
            }

            // Handle interruption
            if (message.serverContent?.interrupted) {
              playerRef.current?.clearQueue();
            }

            // Handle tool calls
            const toolCall = message.toolCall;
            if (toolCall) {
              const call = toolCall.functionCalls.find(c => c.name === 'finish_interview_and_report');
              if (call) {
                const args = (call.args as FinishInterviewArgs) || {};
                const nextReport: InterviewReport = {
                  overall_feedback: args.overall_feedback || fallbackReport.overall_feedback,
                  strengths: Array.isArray(args.strengths) ? args.strengths : fallbackReport.strengths,
                  areas_for_improvement: Array.isArray(args.areas_for_improvement) ? args.areas_for_improvement : fallbackReport.areas_for_improvement,
                  emotion_and_body_language: args.emotion_and_body_language || fallbackReport.emotion_and_body_language,
                  score: typeof args.score === 'number' ? args.score : fallbackReport.score,
                };

                setInterviewReport(nextReport);
                
                // Send response back
                sessionPromise.then(session => {
                  session.sendToolResponse({
                    functionResponses: [{
                      id: call.id,
                      name: call.name,
                      response: { result: "Report generated successfully. You can say goodbye now." }
                    }]
                  });
                  cleanupSession(true);
                });
              }
            }
          },
          onerror: (err) => {
            console.error("Live API Error:", err);
            setError("An error occurred during the interview.");
            if (endRequestedRef.current && !reportRef.current) {
              setInterviewReport(fallbackReport);
            }
            cleanupSession(true);
          },
          onclose: () => {
            if (endRequestedRef.current && !reportRef.current) {
              setInterviewReport(fallbackReport);
            }
            cleanupSession(false);
          }
        }
      });

      sessionRef.current = await sessionPromise;

    } catch (err: any) {
      console.error("Failed to start interview:", err);
      setError(err.message || "Failed to start interview.");
      setIsConnecting(false);
    }
  }, [videoRef, cleanupSession, setInterviewReport]);

  const endInterview = useCallback(() => {
    const session = sessionRef.current;
    if (!session) {
      if (!reportRef.current) {
        setInterviewReport(fallbackReport);
      }
      cleanupSession(false);
      return;
    }

    if (reportRef.current) {
      cleanupSession(true);
      return;
    }

    try {
      requestInterviewEnd(session);
    } catch (endError) {
      console.error('Failed to send end request to live session:', endError);
      if (!reportRef.current) {
        setInterviewReport(fallbackReport);
      }
      cleanupSession(true);
    }
  }, [cleanupSession, requestInterviewEnd, setInterviewReport]);

  return {
    startInterview,
    endInterview,
    isConnecting,
    isConnected,
    isSpeaking,
    report,
    error,
    localStream
  };
}
