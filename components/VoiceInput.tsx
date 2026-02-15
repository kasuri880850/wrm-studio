import React, { useState, useEffect, useRef } from 'react';

interface VoiceInputProps {
  onTranscript: (text: string) => void;
  className?: string;
  placeholder?: string;
}

export const VoiceInput: React.FC<VoiceInputProps> = ({ onTranscript, className, placeholder = "Dictate" }) => {
  const [isListening, setIsListening] = useState(false);
  const [recognition, setRecognition] = useState<any>(null);
  const [interimText, setInterimText] = useState(''); // What is currently being spoken
  const [error, setError] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState<number>(0); // Visual countdown for pause
  
  // Refs to manage timers and state inside event listeners
  const silenceTimer = useRef<NodeJS.Timeout | null>(null);
  const finalTranscriptRef = useRef('');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      // @ts-ignore
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recog = new SpeechRecognition();
        
        // OPTIMIZED SETTINGS:
        recog.continuous = true;      // Keep listening even if user pauses
        recog.interimResults = true;  // Show results as they are being spoken
        recog.lang = 'en-US';         // Ensure consistent language model

        recog.onresult = (event: any) => {
          let interim = '';
          let finalChunk = '';

          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
              finalChunk += event.results[i][0].transcript;
            } else {
              interim += event.results[i][0].transcript;
            }
          }

          if (finalChunk) {
            finalTranscriptRef.current += ' ' + finalChunk;
          }
          
          setInterimText(interim);

          // SMART SILENCE DETECTION (1.5s):
          if (silenceTimer.current) clearTimeout(silenceTimer.current);
          
          // Visual countdown reset
          setTimeLeft(100); 

          // Set new timer: If silence for 1.5 seconds, assume user is done.
          silenceTimer.current = setTimeout(() => {
            stopListening(recog);
          }, 1500); 
        };

        recog.onerror = (event: any) => {
          if (event.error === 'no-speech') return;
          console.error("Speech recognition error", event.error);
          setError("Retry");
          stopListening(recog);
        };

        setRecognition(recog);
      } else {
        setError("Not Supported");
      }
    }
  }, [onTranscript]);

  // Visual Timer Effect
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isListening && interimText) {
        interval = setInterval(() => {
            setTimeLeft(prev => Math.max(0, prev - 10)); // Drain bar over ~1s
        }, 100);
    }
    return () => clearInterval(interval);
  }, [isListening, interimText]);

  const stopListening = (recogInstance: any) => {
    if (recogInstance) {
        recogInstance.stop();
    }
    
    if (silenceTimer.current) clearTimeout(silenceTimer.current);
    
    // Combine final confirmed text with any remaining interim text
    const fullText = (finalTranscriptRef.current + ' ' + interimText).trim();
    
    // CRITICAL: Only send if we actually have text
    if (fullText.length > 0) {
        onTranscript(fullText);
    }
    
    // Reset internal state
    setIsListening(false);
    setInterimText('');
    finalTranscriptRef.current = '';
    setTimeLeft(0);
  };

  const toggleListening = () => {
    if (!recognition) return;

    if (isListening) {
      // Manual stop -> Send immediately
      stopListening(recognition);
    } else {
      setError(null);
      finalTranscriptRef.current = '';
      setInterimText('');
      try {
        recognition.start();
        setIsListening(true);
      } catch (e) {
        console.error(e);
        setError("Error");
      }
    }
  };

  return (
    <div className="relative inline-block">
      <button
        onClick={toggleListening}
        className={`relative flex items-center justify-center gap-2 px-3 py-2 rounded-lg transition-all ${
          isListening 
            ? 'bg-red-500 text-white shadow-lg shadow-red-500/30 scale-105' 
            : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
        } ${className}`}
        title={isListening ? "Tap to Send Immediately" : "Tap to Speak"}
        type="button"
      >
        <span className="text-lg">{isListening ? '⏹' : '🎤'}</span>
        {isListening && <span className="text-xs font-bold animate-pulse">Listening...</span>}
      </button>
      
      {/* Floating Preview Bubble */}
      {isListening && (
        <div className="absolute bottom-12 left-1/2 -translate-x-1/2 w-72 bg-slate-900/95 backdrop-blur-md text-white text-xs p-4 rounded-xl shadow-2xl z-50 pointer-events-none border border-slate-700 transform transition-all animate-fade-in">
           <div className="flex justify-between items-center mb-2 border-b border-slate-700 pb-1">
              <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px]">Live Transcript</span>
              <span className="text-[9px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded animate-pulse">REC</span>
           </div>
           
           <div className="font-medium leading-relaxed text-sm min-h-[1.5em]">
             <span className="text-slate-300">{finalTranscriptRef.current}</span>
             <span className="text-white bg-blue-600/30 px-1 rounded mx-0.5">{interimText}</span>
             <span className="animate-pulse w-1 h-4 bg-blue-500 inline-block align-middle ml-1"></span>
           </div>

           {/* Auto-Send Progress Bar */}
           <div className="mt-3 pt-2 border-t border-slate-800">
             <div className="flex justify-between text-[9px] text-slate-500 mb-1">
               <span>Auto-send in 1.5s</span>
               <span>{timeLeft > 0 ? 'Resets on speech' : 'Sending...'}</span>
             </div>
             <div className="h-1 w-full bg-slate-800 rounded-full overflow-hidden">
               <div 
                 className="h-full bg-blue-500 transition-all duration-300 ease-out"
                 style={{ width: `${interimText ? 100 : 0}%`, opacity: interimText ? 1 : 0.3 }}
               ></div>
             </div>
           </div>
        </div>
      )}

      {error && <span className="absolute -top-8 left-1/2 -translate-x-1/2 bg-red-600 text-white text-[10px] font-bold px-2 py-1 rounded-full whitespace-nowrap z-50 shadow-sm animate-bounce">{error}</span>}
    </div>
  );
};