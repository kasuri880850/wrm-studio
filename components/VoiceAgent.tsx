import React, { useRef, useState, useEffect } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Blob as GenAIBlob, Type } from '@google/genai';
import { GEMINI_LIVE_MODEL } from '../constants';
import { VoiceSession, VoiceTranscriptItem, SavedItem } from '../types';
import { saveToProject } from './ProjectsView';

// PCM Audio Utils
function createBlob(data: Float32Array): GenAIBlob {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    int16[i] = data[i] * 32768;
  }
  const binary = new Uint8Array(int16.buffer);
  let binaryStr = '';
  for(let i=0; i<binary.byteLength; i++) binaryStr += String.fromCharCode(binary[i]);
  const b64 = btoa(binaryStr);
  return {
    data: b64,
    mimeType: 'audio/pcm;rate=16000',
  };
}

function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

export const VoiceAgent: React.FC = () => {
  // --- State ---
  const [activeTab, setActiveTab] = useState<'live' | 'memory'>('live');
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  
  // Live Transcript State
  const [currentTranscripts, setCurrentTranscripts] = useState<VoiceTranscriptItem[]>([]);
  
  // History/Memory State
  const [sessions, setSessions] = useState<VoiceSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  // --- Refs ---
  const nextStartTime = useRef(0);
  const inputAudioContext = useRef<AudioContext | null>(null);
  const outputAudioContext = useRef<AudioContext | null>(null);
  const sources = useRef<Set<AudioBufferSourceNode>>(new Set());
  const sessionRef = useRef<any>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const finalizedSessionIds = useRef<Set<string>>(new Set());

  // --- Load History on Mount ---
  useEffect(() => {
    const saved = localStorage.getItem('wrm_voice_memory');
    if (saved) {
      try {
        setSessions(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to parse voice memory", e);
      }
    }
  }, []);

  // --- Auto-scroll Live Chat ---
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentTranscripts]);

  // --- Save History Helper ---
  const saveToMemory = (updatedSessions: VoiceSession[]) => {
    setSessions(updatedSessions);
    localStorage.setItem('wrm_voice_memory', JSON.stringify(updatedSessions));
  };

  const handleSaveToProject = (session: VoiceSession) => {
    const item: SavedItem = {
      id: session.id,
      type: 'VOICE_SESSION',
      title: session.title,
      date: session.startTime,
      data: session,
      tags: ['voice-agent', 'transcription']
    };
    saveToProject(item);
  };

  const startSession = async () => {
    setError(null);
    setCurrentTranscripts([]); // Clear UI for new session
    const newSessionId = Date.now().toString();
    setCurrentSessionId(newSessionId);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      inputAudioContext.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      outputAudioContext.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const outputNode = outputAudioContext.current.createGain();
      outputNode.connect(outputAudioContext.current.destination);

      // Define Tool for Ending Session Verbally
      const tools = [{
        functionDeclarations: [
          {
            name: "end_session",
            description: "End the voice session and save the conversation memory.",
            parameters: {
              type: Type.OBJECT,
              properties: {},
            }
          }
        ]
      }];

      const sessionPromise = ai.live.connect({
        model: GEMINI_LIVE_MODEL,
        callbacks: {
          onopen: () => {
            console.log("Live Session Open");
            setConnected(true);
            
            // Start recording
            if (!inputAudioContext.current) return;
            const source = inputAudioContext.current.createMediaStreamSource(stream);
            const scriptProcessor = inputAudioContext.current.createScriptProcessor(4096, 1, 1);
            processorRef.current = scriptProcessor;

            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createBlob(inputData);
              sessionPromise.then((session: any) => {
                session.sendRealtimeInput({ media: pcmBlob });
              });
            };

            source.connect(scriptProcessor);
            scriptProcessor.connect(inputAudioContext.current.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            // 1. Handle Text Transcription
            const serverContent = message.serverContent;
            if (serverContent) {
              const timestamp = new Date().toLocaleTimeString();

              // User Transcription (Input)
              if (serverContent.inputTranscription) {
                 const text = serverContent.inputTranscription.text;
                 if (text) {
                   setCurrentTranscripts(prev => {
                     const last = prev[prev.length - 1];
                     // Determine if we update the last bubble or create a new one
                     if (last && last.role === 'user' && !last.isFinal) {
                       // Update existing user bubble
                       const updated = [...prev];
                       updated[updated.length - 1] = { ...last, text: text }; // Accumulate logic depends on API, usually it sends full segments
                       return updated;
                     } else {
                       // New bubble
                       return [...prev, { id: Date.now().toString(), role: 'user', text, timestamp, isFinal: false }];
                     }
                   });
                 }
              }

              // Model Transcription (Output)
              if (serverContent.outputTranscription) {
                const text = serverContent.outputTranscription.text;
                if (text) {
                   setCurrentTranscripts(prev => {
                     const last = prev[prev.length - 1];
                     if (last && last.role === 'model' && !last.isFinal) {
                       const updated = [...prev];
                       updated[updated.length - 1] = { ...last, text: last.text + text }; // Stream accumulation
                       return updated;
                     } else {
                       return [...prev, { id: Date.now().toString(), role: 'model', text, timestamp, isFinal: false }];
                     }
                   });
                }
              }

              // Turn Complete (Finalize bubbles)
              if (serverContent.turnComplete) {
                setCurrentTranscripts(prev => prev.map(t => ({ ...t, isFinal: true })));
              }
            }

            // 2. Handle Tool Calls (e.g., "End Chat")
            if (message.toolCall) {
              for (const fc of message.toolCall.functionCalls) {
                if (fc.name === 'end_session') {
                  // Acknowledge the tool call
                  sessionPromise.then(s => s.sendToolResponse({
                    functionResponses: { id: fc.id, name: fc.name, response: { result: "Session Ended" } }
                  }));
                  // Trigger local stop
                  setTimeout(() => {
                    stopSession(newSessionId);
                  }, 500); 
                }
              }
            }

            // 3. Handle Audio Output
            const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio && outputAudioContext.current) {
              setIsSpeaking(true);
              const ctx = outputAudioContext.current;
              nextStartTime.current = Math.max(nextStartTime.current, ctx.currentTime);
              
              const audioBytes = decode(base64Audio);
              const audioBuffer = await decodeAudioData(audioBytes, ctx, 24000, 1);
              
              const source = ctx.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(outputNode);
              
              source.addEventListener('ended', () => {
                sources.current.delete(source);
                if (sources.current.size === 0) setIsSpeaking(false);
              });

              source.start(nextStartTime.current);
              nextStartTime.current += audioBuffer.duration;
              sources.current.add(source);
            }
          },
          onclose: () => {
            console.log("Session Closed");
            setConnected(false);
            setIsSpeaking(false);
            finalizeSession(newSessionId);
          },
          onerror: (e) => {
            console.error(e);
            setError("Connection Error: The session was interrupted. Please try again.");
            setConnected(false);
            finalizeSession(newSessionId);
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          // CRITICAL FIX: Use empty object for input transcription unless specific model is required/supported by backend
          inputAudioTranscription: {}, 
          outputAudioTranscription: {},
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } }
          },
          tools: tools,
          systemInstruction: `
            You are a highly intelligent and accurate bilingual voice assistant for WRM STUDIO.
            
            CORE RULES:
            1. LANGUAGE: You fully understand English, Urdu, and Roman Urdu.
            2. OUTPUT: ALWAYS respond in clear, professional ENGLISH.
            3. ACCURACY: Strive for 100% accuracy.
            4. COMMANDS: If the user says "End chat", "End call", "Stop", "Bye", or similar closing phrases, CALL the 'end_session' tool immediately.
            5. FORMAT: Keep responses concise.
          `
        }
      });
      
      sessionRef.current = sessionPromise;

    } catch (err: any) {
      console.error(err);
      setError("Failed to start session: " + err.message);
    }
  };

  // Helper to save session state to LS when closed
  const finalizeSession = (sessionId: string) => {
    // Prevent double saving for the same session ID
    if (finalizedSessionIds.current.has(sessionId)) return;
    
    setCurrentTranscripts(finalTranscripts => {
      // Don't save empty sessions
      if (finalTranscripts.length === 0) return finalTranscripts;

      finalizedSessionIds.current.add(sessionId);

      setSessions(prev => {
        // Double check if already in state to be safe (e.g. strict mode double invoke)
        if (prev.some(s => s.id === sessionId)) return prev;

        const newSession: VoiceSession = {
          id: sessionId,
          startTime: new Date().toLocaleString(),
          title: `Voice Session - ${new Date().toLocaleTimeString()}`,
          transcripts: finalTranscripts
        };
        const updated = [newSession, ...prev];
        localStorage.setItem('wrm_voice_memory', JSON.stringify(updated));
        return updated;
      });
      return finalTranscripts;
    });
  };

  const stopSession = async (explicitSessionId?: string) => {
    const sId = explicitSessionId || currentSessionId;
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (inputAudioContext.current) {
      await inputAudioContext.current.close();
      inputAudioContext.current = null;
    }
    if (outputAudioContext.current) {
      await outputAudioContext.current.close();
      outputAudioContext.current = null;
    }
    if (sessionRef.current) {
        sessionRef.current.then((session: any) => {
             try { session.close(); } catch(e){}
        });
    }

    setConnected(false);
    setIsSpeaking(false);
    nextStartTime.current = 0;
    
    // Explicitly try to finalize if we have a session ID, in case onclose doesn't fire or fires late
    if (sId) {
      finalizeSession(sId);
    }
  };

  useEffect(() => {
    return () => {
      if (currentSessionId) stopSession(currentSessionId);
    };
  }, []);

  // --- Editing Logic ---
  const handleEditStart = (item: VoiceTranscriptItem) => {
    setEditingItemId(item.id);
    setEditValue(item.text);
  };

  const handleEditSave = (sessionId: string, itemId: string) => {
    const updatedSessions = sessions.map(session => {
      if (session.id === sessionId) {
        return {
          ...session,
          transcripts: session.transcripts.map(t => 
            t.id === itemId ? { ...t, text: editValue } : t
          )
        };
      }
      return session;
    });
    saveToMemory(updatedSessions);
    setEditingItemId(null);
  };

  const deleteSession = (id: string) => {
    const updated = sessions.filter(s => s.id !== id);
    saveToMemory(updated);
  };

  // --- Render ---

  return (
    <div className="h-full flex flex-col bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 transition-colors">
      
      {/* Tab Navigation */}
      <div className="flex border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-8 pt-4">
        <button
          onClick={() => setActiveTab('live')}
          className={`pb-4 px-6 font-semibold text-sm transition-colors relative ${
            activeTab === 'live' 
              ? 'text-blue-600 dark:text-blue-400' 
              : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
          }`}
        >
          🎙️ Live Agent
          {activeTab === 'live' && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-blue-600 dark:bg-blue-400 rounded-t-full"></div>}
        </button>
        <button
          onClick={() => setActiveTab('memory')}
          className={`pb-4 px-6 font-semibold text-sm transition-colors relative ${
            activeTab === 'memory' 
              ? 'text-blue-600 dark:text-blue-400' 
              : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
          }`}
        >
          🧠 Virtual Memory
          {activeTab === 'memory' && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-blue-600 dark:bg-blue-400 rounded-t-full"></div>}
        </button>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-hidden relative">
        
        {/* VIEW: LIVE AGENT */}
        {activeTab === 'live' && (
          <div className="h-full flex flex-col md:flex-row">
            
            {/* Visualizer Column */}
            <div className="w-full md:w-1/3 p-8 flex flex-col items-center justify-center border-b md:border-b-0 md:border-r border-slate-200 dark:border-slate-700 bg-white/50 dark:bg-slate-800/30 backdrop-blur-sm">
              <div className={`relative w-48 h-48 rounded-full flex items-center justify-center transition-all duration-500 mb-8 ${
                connected 
                  ? 'bg-blue-50 dark:bg-blue-900/30 shadow-[0_0_60px_-15px_rgba(37,99,235,0.3)]' 
                  : 'bg-slate-100 dark:bg-slate-800'
              }`}>
                {connected && isSpeaking && (
                  <div className="absolute inset-0 rounded-full border-4 border-blue-400 animate-ping opacity-20"></div>
                )}
                <div className={`z-10 text-6xl transition-transform duration-300 ${isSpeaking ? 'scale-110' : 'scale-100'}`}>
                   {connected ? '🎙️' : '🔇'}
                </div>
              </div>

              {error && <div className="mb-4 text-red-500 text-sm bg-red-50 px-3 py-1 rounded max-w-xs text-center">{error}</div>}

              {!connected ? (
                <button
                  onClick={startSession}
                  className="w-full max-w-xs bg-gradient-to-r from-blue-600 to-indigo-600 text-white py-4 rounded-xl font-bold hover:shadow-lg hover:shadow-blue-500/20 active:scale-95 transition-all flex items-center justify-center gap-2"
                >
                   <span>Start Call</span>
                </button>
              ) : (
                <button
                  onClick={() => stopSession()}
                  className="w-full max-w-xs bg-red-500 text-white py-4 rounded-xl font-bold hover:bg-red-600 shadow-lg active:scale-95 transition-all"
                >
                  End Call
                </button>
              )}
              
              <div className="mt-8 text-center text-xs text-slate-400">
                <p>Supports: English, Urdu, Roman Urdu</p>
                <p className="mt-1">Say <strong>"End Chat"</strong> to save & close.</p>
              </div>
            </div>

            {/* Live Chat Column */}
            <div className="w-full md:w-2/3 flex flex-col h-full bg-slate-50 dark:bg-slate-900">
              <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
                 <h3 className="font-bold text-slate-700 dark:text-slate-200">Live Transcription</h3>
                 <span className="text-xs text-slate-400 uppercase tracking-wider">{connected ? '● Recording' : '○ Idle'}</span>
              </div>
              
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                 {currentTranscripts.length === 0 ? (
                   <div className="h-full flex flex-col items-center justify-center text-slate-300 dark:text-slate-600">
                      <span className="text-4xl mb-2">💬</span>
                      <p>Conversation history will appear here...</p>
                   </div>
                 ) : (
                   currentTranscripts.map((t, idx) => (
                     <div key={idx} className={`flex ${t.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[80%] rounded-2xl p-4 shadow-sm ${
                          t.role === 'user'
                            ? 'bg-blue-600 text-white rounded-br-none'
                            : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 rounded-bl-none'
                        }`}>
                           <p className="leading-relaxed whitespace-pre-wrap">{t.text}</p>
                           <div className={`text-[10px] mt-2 opacity-70 ${t.role === 'user' ? 'text-blue-100' : 'text-slate-400'}`}>
                             {t.timestamp}
                           </div>
                        </div>
                     </div>
                   ))
                 )}
                 <div ref={chatEndRef} />
              </div>
            </div>
          </div>
        )}

        {/* VIEW: MEMORY ARCHIVES */}
        {activeTab === 'memory' && (
          <div className="h-full p-8 overflow-y-auto max-w-5xl mx-auto">
             <div className="mb-8 flex justify-between items-end">
               <div>
                 <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Memory Archives</h2>
                 <p className="text-slate-500 dark:text-slate-400 mt-1">Review, edit, and manage your past voice conversations.</p>
               </div>
               <div className="text-sm font-medium text-slate-500 bg-white dark:bg-slate-800 px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm">
                 {sessions.length} Saved Sessions
               </div>
             </div>

             <div className="space-y-6">
               {sessions.length === 0 ? (
                 <div className="text-center py-20 bg-white dark:bg-slate-800 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700">
                    <p className="text-slate-400">No saved memory yet. Start a call to create one.</p>
                 </div>
               ) : (
                 sessions.map((session) => (
                   <div key={session.id} className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden transition-all hover:shadow-md">
                     <div className="bg-slate-50 dark:bg-slate-700/50 p-4 flex justify-between items-center border-b border-slate-100 dark:border-slate-700">
                        <div className="flex items-center gap-3">
                           <span className="text-2xl">🧠</span>
                           <div>
                             <h4 className="font-bold text-slate-800 dark:text-white">{session.title}</h4>
                             <p className="text-xs text-slate-500">{session.startTime}</p>
                           </div>
                        </div>
                        <div className="flex gap-2">
                           <button
                             onClick={() => handleSaveToProject(session)}
                             className="text-blue-500 hover:text-blue-700 p-2 text-sm font-medium"
                             title="Save to Project"
                           >
                             📂 Save
                           </button>
                           <button 
                             onClick={() => deleteSession(session.id)}
                             className="text-red-400 hover:text-red-600 p-2"
                             title="Delete Memory"
                           >
                             🗑️
                           </button>
                        </div>
                     </div>
                     
                     <div className="p-6 space-y-4 max-h-96 overflow-y-auto bg-slate-50/50 dark:bg-slate-900/20">
                        {session.transcripts.map((t) => (
                          <div key={t.id} className={`flex gap-4 ${t.role === 'user' ? 'flex-row-reverse' : ''}`}>
                             <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${
                               t.role === 'user' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                             }`}>
                               {t.role === 'user' ? 'U' : 'AI'}
                             </div>
                             
                             <div className={`flex-1 group`}>
                               {editingItemId === t.id ? (
                                 <div className="flex gap-2 items-start animate-fade-in">
                                   <textarea
                                     value={editValue}
                                     onChange={(e) => setEditValue(e.target.value)}
                                     className="w-full p-3 rounded-lg border border-blue-300 focus:ring-2 focus:ring-blue-500 outline-none text-sm dark:bg-slate-700 dark:border-slate-600"
                                     rows={3}
                                   />
                                   <div className="flex flex-col gap-1">
                                      <button 
                                        onClick={() => handleEditSave(session.id, t.id)}
                                        className="bg-green-500 text-white p-2 rounded hover:bg-green-600"
                                      >
                                        ✓
                                      </button>
                                      <button 
                                        onClick={() => setEditingItemId(null)}
                                        className="bg-slate-300 text-slate-700 p-2 rounded hover:bg-slate-400"
                                      >
                                        ✕
                                      </button>
                                   </div>
                                 </div>
                               ) : (
                                 <div className="relative">
                                    <div 
                                      onClick={() => handleEditStart(t)}
                                      className={`p-3 rounded-lg text-sm border cursor-pointer transition-colors hover:border-blue-300 dark:hover:border-blue-500 ${
                                        t.role === 'user' 
                                          ? 'bg-blue-50 dark:bg-slate-700/50 border-blue-100 dark:border-slate-700' 
                                          : 'bg-white dark:bg-slate-800 border-slate-100 dark:border-slate-700'
                                      }`}
                                    >
                                      {t.text}
                                    </div>
                                    <div className="flex justify-between mt-1 px-1">
                                      <span className="text-[10px] text-slate-400">{t.timestamp}</span>
                                      <span className="text-[10px] text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity">Click bubble to edit</span>
                                    </div>
                                 </div>
                               )}
                             </div>
                          </div>
                        ))}
                     </div>
                   </div>
                 ))
               )}
             </div>
          </div>
        )}

      </div>
    </div>
  );
};