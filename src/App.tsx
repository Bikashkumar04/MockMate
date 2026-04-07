import React, { useState, useEffect, useRef } from 'react';
import { useLiveInterview } from './hooks/useLiveInterview';
import { extractTextFromPdf } from './lib/pdfUtils';
import { Upload, Square, FileText, Download, Loader2, Play, Video } from 'lucide-react';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { cn } from './lib/utils';
import aiAvatar from './assets/iavatar.jpg';

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const { startInterview, endInterview, isConnecting, isConnected, isSpeaking, report, error, localStream } = useLiveInterview(videoRef);
  
  const [jobDescription, setJobDescription] = useState('');
  const [resumeText, setResumeText] = useState('');
  const [resumeFileName, setResumeFileName] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isConnected) {
      interval = setInterval(() => setDuration(d => d + 1), 1000);
    } else {
      setDuration(0);
    }
    return () => clearInterval(interval);
  }, [isConnected]);

  useEffect(() => {
    if (videoRef.current && localStream) {
      videoRef.current.srcObject = localStream;
    }
  }, [localStream, isConnected]);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setResumeFileName(file.name);
    setIsExtracting(true);
    
    try {
      if (file.type === 'application/pdf') {
        const text = await extractTextFromPdf(file);
        setResumeText(text);
      } else {
        const text = await file.text();
        setResumeText(text);
      }
    } catch (err) {
      console.error("Error reading file:", err);
      alert("Failed to read the file. Please try another one.");
    } finally {
      setIsExtracting(false);
    }
  };

  const handleStart = () => {
    if (!jobDescription || !resumeText) {
      alert("Please provide both a job description and a resume.");
      return;
    }
    startInterview(resumeText, jobDescription);
  };

  const downloadPdf = async () => {
    const reportElement = document.getElementById('report-content');
    if (!reportElement) return;

    const canvas = await html2canvas(reportElement, { scale: 2 });
    const imgData = canvas.toDataURL('image/png');
    
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
    
    pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
    pdf.save('Interview_Report.pdf');
  };

  if (report) {
    return (
      <div className="min-h-screen bg-gray-50 p-8 font-sans">
        <div className="max-w-4xl mx-auto">
          <div className="flex justify-between items-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900">Interview Report</h1>
            <button
              onClick={downloadPdf}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Download className="w-4 h-4" />
              Download PDF
            </button>
          </div>
          
          <div id="report-content" className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100">
            <div className="mb-8 flex items-center justify-between border-b pb-6">
              <div>
                <h2 className="text-xl font-semibold text-gray-800">Overall Score</h2>
                <p className="text-gray-500 text-sm mt-1">Based on technical and behavioral evaluation</p>
              </div>
              <div className="text-4xl font-bold text-blue-600">
                {report.score}/10
              </div>
            </div>

            <div className="mb-8">
              <h3 className="text-lg font-semibold text-gray-800 mb-3">Overall Feedback</h3>
              <p className="text-gray-600 leading-relaxed">{report.overall_feedback}</p>
            </div>

            <div className="mb-8 bg-blue-50 p-6 rounded-xl border border-blue-100">
              <h3 className="text-lg font-semibold text-blue-800 mb-3 flex items-center gap-2">
                <Video className="w-5 h-5" />
                Emotion & Body Language Analysis
              </h3>
              <p className="text-blue-900 leading-relaxed">{report.emotion_and_body_language}</p>
            </div>

            <div className="grid md:grid-cols-2 gap-8">
              <div>
                <h3 className="text-lg font-semibold text-green-700 mb-4 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-500" />
                  Strengths
                </h3>
                <ul className="space-y-3">
                  {report.strengths.map((strength, i) => (
                    <li key={i} className="flex items-start gap-3 text-gray-600">
                      <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />
                      <span className="leading-relaxed">{strength}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <h3 className="text-lg font-semibold text-amber-700 mb-4 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-amber-500" />
                  Areas for Improvement
                </h3>
                <ul className="space-y-3">
                  {report.areas_for_improvement.map((area, i) => (
                    <li key={i} className="flex items-start gap-3 text-gray-600">
                      <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                      <span className="leading-relaxed">{area}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
          
          <div className="mt-8 text-center">
            <button
              onClick={() => window.location.reload()}
              className="text-gray-500 hover:text-gray-800 underline"
            >
              Start a new interview
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (isConnected || isConnecting) {
    return (
      <div className="relative w-full h-screen bg-gray-900 overflow-hidden flex flex-col font-sans">
        {/* Main Video Area */}
        <div className="flex-1 relative p-4 pb-24">
          <div className="w-full h-full relative rounded-2xl overflow-hidden bg-gray-800 shadow-2xl border border-gray-700 flex items-center justify-center">
            {isConnecting && !localStream ? (
              <div className="flex flex-col items-center gap-4">
                <Loader2 className="w-12 h-12 text-blue-400 animate-spin" />
                <p className="text-gray-400">Preparing your AI interviewer...</p>
              </div>
            ) : (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover -scale-x-100"
              />
            )}
            
            {/* AI Avatar / Wave Overlay */}
            {isConnected && (
              <div className="absolute top-6 right-6 bg-gray-900/85 backdrop-blur-md p-5 rounded-2xl border border-gray-700 shadow-xl flex flex-col items-center gap-4 min-w-52">
                <div className="text-gray-200 text-sm font-medium">AI Interviewer</div>
                <div className="relative w-20 h-20 rounded-full overflow-hidden border-2 border-blue-300 shadow-lg shadow-blue-500/25">
                  <img
                    src={aiAvatar}
                    alt="MockMate AI interviewer avatar"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent" />
                </div>
                <div className="flex items-end justify-center gap-1.5 h-12">
                  {[...Array(5)].map((_, i) => (
                    <div
                      key={i}
                      className={cn(
                        "w-2 bg-blue-500 rounded-full origin-bottom transition-all duration-200",
                        isSpeaking ? "animate-wave" : "scale-y-20"
                      )}
                      style={{ 
                        animationDelay: `${i * 0.15}s`,
                        height: '100%'
                      }}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Timer Overlay */}
            {isConnected && (
              <div className="absolute top-6 left-6 bg-gray-900/80 backdrop-blur-md px-4 py-2 rounded-lg border border-gray-700 shadow-xl flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <span className="text-white font-mono font-medium">{formatTime(duration)}</span>
              </div>
            )}
            
            {/* Error Overlay */}
            {error && (
              <div className="absolute bottom-6 left-1/2 -translate-x-1/2 p-4 bg-red-500/90 backdrop-blur-md border border-red-400 rounded-lg text-white text-sm text-center shadow-xl">
                {error}
              </div>
            )}
          </div>
        </div>

        {/* Bottom Control Bar */}
        <div className="absolute bottom-0 left-0 right-0 h-24 bg-gray-900/90 backdrop-blur-lg border-t border-gray-800 flex items-center justify-center gap-6 px-8">
          {isConnected && (
            <button
              onClick={endInterview}
              className="flex items-center gap-2 px-6 py-3 bg-red-500 text-white hover:bg-red-600 rounded-full font-medium transition-colors shadow-lg shadow-red-500/20"
            >
              <Square className="w-5 h-5 fill-current" />
              End Interview
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0b1f4d] py-10 px-4 sm:px-6 lg:px-8 font-sans">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#f7c948] mb-5 shadow-lg shadow-black/20 overflow-hidden">
            <img
              src={aiAvatar}
              alt="MockMate icon"
              className="w-full h-full object-cover"
            />
          </div>
          <h1 className="text-4xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-[#f7c948] to-[#f0ebce]">
            MockMate
          </h1>
          <p className="mt-3 text-base text-blue-100/90 font-medium">
            I help you practice mock interviews so you do not fail in real interviews.
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl border border-[#f0d98c] p-6 sm:p-8 space-y-6">
          <div>
            <label className="block text-sm font-semibold text-[#0b1f4d] mb-2">
              Job Description
            </label>
            <textarea
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
              placeholder="Paste the job description here..."
              className="w-full h-36 p-4 rounded-xl border border-blue-200 bg-blue-50/40 focus:bg-white focus:ring-2 focus:ring-[#f7c948] focus:border-transparent transition-all resize-none text-[#0b1f4d]"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-[#0b1f4d] mb-2">
              Your Resume
            </label>
            <div className="relative group">
              <input
                type="file"
                accept=".pdf,.txt"
                onChange={handleFileUpload}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              />
              <div className={cn(
                "w-full p-7 rounded-xl border-2 border-dashed transition-colors flex flex-col items-center justify-center gap-2",
                resumeFileName ? "border-[#f7c948] bg-[#fff8de]" : "border-blue-300 bg-blue-50/30 group-hover:border-[#f7c948] group-hover:bg-[#fff8de]"
              )}>
                {isExtracting ? (
                  <Loader2 className="w-7 h-7 text-[#0b1f4d] animate-spin" />
                ) : resumeFileName ? (
                  <>
                    <FileText className="w-7 h-7 text-[#0b1f4d]" />
                    <span className="text-[#0b1f4d] font-semibold">{resumeFileName}</span>
                    <span className="text-[#375a9d] text-sm">Click to replace</span>
                  </>
                ) : (
                  <>
                    <Upload className="w-7 h-7 text-[#375a9d] group-hover:text-[#0b1f4d] transition-colors" />
                    <span className="text-[#0b1f4d] font-medium">Upload Resume (PDF or TXT)</span>
                    <span className="text-[#375a9d] text-sm">Max 5MB</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <button
            onClick={handleStart}
            disabled={!jobDescription || !resumeText || isExtracting}
            className="w-full py-3.5 px-6 rounded-xl bg-[#0b1f4d] text-[#f7c948] font-semibold text-lg hover:bg-[#132c67] disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
          >
            <Play className="w-5 h-5 fill-current" />
            Start Mock Interview
          </button>

          {error && (
            <p className="text-red-500 text-sm text-center">{error}</p>
          )}
        </div>
      </div>
    </div>
  );
}
