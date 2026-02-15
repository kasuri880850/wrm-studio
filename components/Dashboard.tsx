import React, { useState, useRef, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { analyzeReviews } from '../services/geminiService';
import { AnalysisResult, SavedItem } from '../types';
import { ChatBot } from './ChatBot';
import { jsPDF } from 'jspdf';
import { GoogleGenAI, LiveServerMessage, Modality, Type, Blob as GenAIBlob } from '@google/genai';
import { GEMINI_LIVE_MODEL } from '../constants';
import { VoiceInput } from './VoiceInput';
import { saveToProject } from './ProjectsView';

// PCM Audio Utils (duplicated for Dashboard isolation)
function createBlob(data: Float32Array): GenAIBlob {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) { int16[i] = data[i] * 32768; }
  const binary = new Uint8Array(int16.buffer);
  let binaryStr = '';
  for(let i=0; i<binary.byteLength; i++) binaryStr += String.fromCharCode(binary[i]);
  return { data: btoa(binaryStr), mimeType: 'audio/pcm;rate=16000' };
}
function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) { bytes[i] = binaryString.charCodeAt(i); }
  return bytes;
}
async function decodeAudioData(data: Uint8Array, ctx: AudioContext, sampleRate: number, numChannels: number): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  for (let c = 0; c < numChannels; c++) {
    const channelData = buffer.getChannelData(c);
    for (let i = 0; i < frameCount; i++) { channelData[i] = dataInt16[i * numChannels + c] / 32768.0; }
  }
  return buffer;
}

export const Dashboard: React.FC = () => {
  const [inputText, setInputText] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [data, setData] = useState<AnalysisResult | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(true);
  const [activeKeyword, setActiveKeyword] = useState<string | null>(null);
  
  // Voice State
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  
  // Voice Refs
  const inputAudioContext = useRef<AudioContext | null>(null);
  const outputAudioContext = useRef<AudioContext | null>(null);
  const sessionRef = useRef<any>(null);
  const nextStartTime = useRef(0);

  // Derived filtered reviews
  const rawReviews = inputText.split(/\n+/).filter(r => r.trim().length > 0);
  const filteredReviews = activeKeyword 
    ? rawReviews.filter(r => r.toLowerCase().includes(activeKeyword.toLowerCase())) 
    : [];

  const handleAnalyze = async (textToAnalyze = inputText) => {
    if (!textToAnalyze.trim()) return;
    setIsAnalyzing(true);
    try {
      const result = await analyzeReviews(textToAnalyze);
      setData(result);
    } catch (error) {
      console.error(error);
      alert("Analysis failed. Please try again.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSaveToProject = () => {
    if (!data) return;
    const item: SavedItem = {
      id: Date.now().toString(),
      type: 'ANALYSIS',
      title: data.summary.title,
      date: new Date().toLocaleDateString(),
      data: data,
      tags: ['analysis', 'sentiment']
    };
    saveToProject(item);
  };

  // --- Voice Control Logic ---
  const toggleVoice = async () => {
    if (isVoiceActive) {
      stopVoice();
    } else {
      startVoice();
    }
  };

  const startVoice = async () => {
    setVoiceError(null);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      inputAudioContext.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      outputAudioContext.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      const outputNode = outputAudioContext.current.createGain();
      outputNode.connect(outputAudioContext.current.destination);

      const tools = [{
        functionDeclarations: [
          {
            name: "appendReviews",
            description: "Append dictation or text to the review input area.",
            parameters: {
              type: Type.OBJECT,
              properties: { text: { type: Type.STRING } },
              required: ["text"]
            }
          },
          {
            name: "triggerAnalysis",
            description: "Run the sentiment analysis on the current text.",
            parameters: { type: Type.OBJECT, properties: {} }
          }
        ]
      }];

      const sessionPromise = ai.live.connect({
        model: GEMINI_LIVE_MODEL,
        callbacks: {
          onopen: () => {
            setIsVoiceActive(true);
            const source = inputAudioContext.current!.createMediaStreamSource(stream);
            const processor = inputAudioContext.current!.createScriptProcessor(4096, 1, 1);
            processor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createBlob(inputData);
              sessionPromise.then(s => s.sendRealtimeInput({ media: pcmBlob }));
            };
            source.connect(processor);
            processor.connect(inputAudioContext.current!.destination);
          },
          onmessage: async (msg: LiveServerMessage) => {
            // Audio Playback
            const base64Audio = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio && outputAudioContext.current) {
              const ctx = outputAudioContext.current;
              nextStartTime.current = Math.max(nextStartTime.current, ctx.currentTime);
              const audioBuffer = await decodeAudioData(decode(base64Audio), ctx, 24000, 1);
              const source = ctx.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(outputNode);
              source.start(nextStartTime.current);
              nextStartTime.current += audioBuffer.duration;
            }

            // Tool Calls
            if (msg.toolCall) {
              for (const fc of msg.toolCall.functionCalls) {
                let result = "ok";
                if (fc.name === "appendReviews") {
                  const newText = (fc.args as any).text;
                  setInputText(prev => prev + "\n" + newText);
                  result = "Added text.";
                } else if (fc.name === "triggerAnalysis") {
                  document.getElementById('analyze-btn')?.click(); 
                  result = "Analysis started.";
                }
                sessionPromise.then(s => s.sendToolResponse({
                  functionResponses: { id: fc.id, name: fc.name, response: { result } }
                }));
              }
            }
          },
          onclose: () => setIsVoiceActive(false),
          onerror: (e) => { console.error(e); setIsVoiceActive(false); setVoiceError("Connection failed"); }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          tools: tools,
          inputAudioTranscription: {}, // Corrected to empty object
          systemInstruction: "You are a dashboard assistant for WRM STUDIO. You can add reviews to the text area and trigger analysis."
        }
      });
      sessionRef.current = sessionPromise;
    } catch (e) {
      console.error(e);
      setVoiceError("Failed to start voice");
    }
  };

  const stopVoice = () => {
    if (sessionRef.current) {
       sessionRef.current.then((s: any) => { try { s.close(); } catch(e){} });
    }
    inputAudioContext.current?.close();
    outputAudioContext.current?.close();
    setIsVoiceActive(false);
  };

  // --- Export Logic ---
  const exportCSV = () => {
    if (!data) return;
    const headers = "Date,Sentiment\n";
    const rows = data.trend.map(p => `${p.date},${p.sentiment}`).join("\n");
    const blob = new Blob([headers + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sentiment_trend.csv';
    a.click();
  };

  const exportPDF = () => {
    if (!data) return;
    const doc = new jsPDF();
    doc.setFontSize(20);
    doc.text(data.summary.title, 20, 20);
    doc.setFontSize(12);
    let y = 40;
    doc.text("Key Takeaways:", 20, y);
    y += 10;
    data.summary.points.forEach(p => {
      const lines = doc.splitTextToSize(`- ${p}`, 170);
      doc.text(lines, 20, y);
      y += 10 * lines.length;
    });
    y += 10;
    doc.text("Actionable Areas:", 20, y);
    y += 10;
    data.summary.actionableAreas.forEach(area => {
       doc.setFont("helvetica", "bold");
       doc.text(area.area, 20, y);
       y += 7;
       doc.setFont("helvetica", "normal");
       const lines = doc.splitTextToSize(area.description, 170);
       doc.text(lines, 20, y);
       y += 10 * lines.length + 5;
    });
    doc.save('executive_summary.pdf');
  };

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 transition-colors duration-300">
      {/* Main Content */}
      <div className={`flex-1 overflow-y-auto p-8 transition-all duration-300 ${isChatOpen ? 'mr-[400px]' : ''}`}>
        <header className="flex justify-between items-start mb-8">
          <div>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">WRM STUDIO Dashboard</h2>
            <p className="text-slate-500 dark:text-slate-400">Analyze reviews, visualize trends, and get AI insights.</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={toggleVoice}
              className={`p-3 rounded-full transition-all shadow-sm flex items-center gap-2 ${
                isVoiceActive 
                  ? 'bg-red-50 text-red-600 animate-pulse border border-red-200 dark:bg-red-900/20 dark:border-red-800' 
                  : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
              }`}
              title="Voice Control"
            >
              {isVoiceActive ? '🔴 Listening...' : '🎙️ Voice Control'}
            </button>
            <button
               onClick={() => setIsChatOpen(!isChatOpen)}
               className="bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 px-4 py-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 font-medium shadow-sm transition-colors"
            >
              {isChatOpen ? 'Close Chat' : 'Open AI Chat'}
            </button>
          </div>
        </header>

        {/* Input Section */}
        <section className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 mb-8 transition-colors">
          <div className="flex justify-between items-center mb-2">
             <label className="text-sm font-bold text-slate-500">Input Data</label>
             <VoiceInput onTranscript={(text) => setInputText(prev => prev + "\n" + text)} />
          </div>
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Paste raw reviews here (separated by newlines) or use Voice Control to dictate..."
            className="w-full h-32 p-4 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-y mb-4 font-mono text-sm transition-colors"
          />
          <div className="flex justify-end gap-2">
            {voiceError && <span className="text-red-500 text-sm self-center mr-4">{voiceError}</span>}
            <button
              id="analyze-btn"
              onClick={() => handleAnalyze()}
              disabled={isAnalyzing || !inputText}
              className={`px-6 py-2.5 rounded-lg font-medium text-white transition-all shadow-md ${
                isAnalyzing || !inputText
                  ? 'bg-slate-400 dark:bg-slate-600 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700 active:scale-95'
              }`}
            >
              {isAnalyzing ? 'Analyzing...' : 'Analyze Sentiment'}
            </button>
          </div>
        </section>

        {data && (
          <div className="space-y-8 animate-fade-in pb-12">
             <div className="flex justify-end gap-2">
                <button onClick={handleSaveToProject} className="text-sm bg-blue-100 text-blue-800 border border-blue-200 px-3 py-1.5 rounded hover:bg-blue-200 transition-colors">
                  📂 Save Project
                </button>
                <button onClick={exportCSV} className="text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-1.5 rounded hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors">
                  ⬇ CSV Trend
                </button>
                <button onClick={exportPDF} className="text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-1.5 rounded hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors">
                  ⬇ PDF Summary
                </button>
             </div>

            {/* Executive Summary */}
            <section className="bg-gradient-to-br from-indigo-50 to-blue-50 dark:from-slate-800 dark:to-slate-800 p-8 rounded-xl border border-blue-100 dark:border-slate-700">
              <h3 className="text-xl font-bold text-indigo-900 dark:text-indigo-300 mb-4 flex items-center gap-2">
                <span className="text-2xl">📑</span> {data.summary.title}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
                {data.summary.actionableAreas.map((area, i) => (
                  <div key={i} className="bg-white dark:bg-slate-700 p-4 rounded-lg shadow-sm border border-indigo-100 dark:border-slate-600 transition-colors">
                    <div className="text-indigo-600 dark:text-indigo-400 font-bold mb-1 uppercase text-xs tracking-wider">Priority #{i + 1}</div>
                    <h5 className="font-bold text-slate-900 dark:text-white mb-2">{area.area}</h5>
                    <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{area.description}</p>
                  </div>
                ))}
              </div>
            </section>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Trend Chart */}
              <section className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 h-[400px] flex flex-col transition-colors">
                <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-6">Sentiment Trend</h3>
                <div className="flex-1">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data.trend}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" className="dark:opacity-20" />
                      <XAxis dataKey="date" stroke="#94a3b8" fontSize={12} tickMargin={10} />
                      <YAxis stroke="#94a3b8" domain={[-1, 1]} fontSize={12} />
                      <Tooltip 
                        contentStyle={{ 
                          borderRadius: '8px', 
                          border: 'none', 
                          boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                          backgroundColor: 'rgba(255, 255, 255, 0.95)',
                          color: '#1e293b'
                        }} 
                      />
                      <Line type="monotone" dataKey="sentiment" stroke="#2563eb" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 8 }} isAnimationActive={true} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </section>

              {/* Word Cloud */}
              <section className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 h-[400px] flex flex-col transition-colors">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-bold text-slate-800 dark:text-white">Key Themes</h3>
                  {activeKeyword && (
                    <button onClick={() => setActiveKeyword(null)} className="text-xs text-red-500 hover:text-red-700 dark:hover:text-red-400">
                      Clear Filter: "{activeKeyword}"
                    </button>
                  )}
                </div>
                <div className="flex-1 overflow-y-auto content-start flex flex-wrap gap-2">
                  {data.keywords.map((kw, i) => {
                    const maxCount = Math.max(...data.keywords.map(k => k.count));
                    const size = 0.8 + (kw.count / maxCount) * 1.5;
                    
                    let colorClass = 'text-slate-500 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600';
                    if (kw.sentiment === 'positive') colorClass = 'text-emerald-700 bg-emerald-50 border-emerald-100 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800';
                    if (kw.sentiment === 'negative') colorClass = 'text-rose-700 bg-rose-50 border-rose-100 hover:bg-rose-100 dark:bg-rose-900/30 dark:text-rose-400 dark:border-rose-800';
                    
                    const isActive = activeKeyword === kw.text;

                    return (
                      <button
                        key={i}
                        onClick={() => setActiveKeyword(isActive ? null : kw.text)}
                        className={`px-3 py-1 rounded-full border dark:border-transparent transition-all ${colorClass} ${isActive ? 'ring-2 ring-blue-500 ring-offset-1 dark:ring-offset-slate-800' : ''}`}
                        style={{ fontSize: `${size}rem` }}
                      >
                        {kw.text}
                      </button>
                    );
                  })}
                </div>
              </section>
            </div>

            {/* Filtered Reviews List */}
            {activeKeyword && (
              <section className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 animate-fade-in transition-colors">
                <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-4">Reviews mentioning "{activeKeyword}"</h3>
                <div className="space-y-3 max-h-64 overflow-y-auto">
                  {filteredReviews.length > 0 ? filteredReviews.map((r, i) => (
                    <div key={i} className="p-3 bg-slate-50 dark:bg-slate-700/50 rounded-lg text-sm text-slate-700 dark:text-slate-300 border border-slate-100 dark:border-slate-700">
                      "{r}"
                    </div>
                  )) : (
                    <p className="text-slate-400 italic">No exact match found in raw text lines.</p>
                  )}
                </div>
              </section>
            )}
          </div>
        )}
      </div>

      {/* Embedded Chat Sidebar */}
      <div 
        className={`fixed right-0 top-0 h-full w-[400px] bg-white dark:bg-slate-800 shadow-xl border-l border-slate-200 dark:border-slate-700 transform transition-transform duration-300 z-20 ${
          isChatOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <ChatBot embedded={true} analysisContext={data} />
      </div>
    </div>
  );
};