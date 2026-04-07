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
  const videoIntervalRef = useRef<any>(null);

  const startInterview = useCallback(async (resumeText: string, jobDescription: string) => {
    setIsConnecting(true);
    setError(null);
    setReport(null);

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
                const args = call.args as any;
                setReport({
                  overall_feedback: args.overall_feedback,
                  strengths: args.strengths,
                  areas_for_improvement: args.areas_for_improvement,
                  emotion_and_body_language: args.emotion_and_body_language,
                  score: args.score
                });
                
                // Send response back
                sessionPromise.then(session => {
                  session.sendToolResponse({
                    functionResponses: [{
                      id: call.id,
                      name: call.name,
                      response: { result: "Report generated successfully. You can say goodbye now." }
                    }]
                  });
                });
              }
            }
          },
          onerror: (err) => {
            console.error("Live API Error:", err);
            setError("An error occurred during the interview.");
            endInterview();
          },
          onclose: () => {
            setIsConnected(false);
            if (videoIntervalRef.current) clearInterval(videoIntervalRef.current);
            recorderRef.current?.stop();
            playerRef.current?.stop();
          }
        }
      });

      sessionRef.current = await sessionPromise;

    } catch (err: any) {
      console.error("Failed to start interview:", err);
      setError(err.message || "Failed to start interview.");
      setIsConnecting(false);
    }
  }, [videoRef]);

  const endInterview = useCallback(() => {
    if (sessionRef.current) {
      if (videoIntervalRef.current) clearInterval(videoIntervalRef.current);
      // Ask the model to generate the report before closing if it hasn't already
      if (!report) {
         sessionRef.current.sendRealtimeInput({
            text: "I would like to end the interview now. Please call the finish_interview_and_report tool to generate my feedback."
         });
         // We don't close immediately, wait for the tool call
         setTimeout(() => {
            sessionRef.current?.close();
            sessionRef.current = null;
            setIsConnected(false);
            recorderRef.current?.stop();
            playerRef.current?.stop();
         }, 5000);
      } else {
        sessionRef.current.close();
        sessionRef.current = null;
        setIsConnected(false);
        recorderRef.current?.stop();
        playerRef.current?.stop();
      }
    }
  }, [report]);

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
