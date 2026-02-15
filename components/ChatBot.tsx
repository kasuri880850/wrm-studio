import React, { useState, useRef, useEffect } from 'react';
import { chatWithGemini } from '../services/geminiService';
import { ChatMessage, AnalysisResult, SavedItem } from '../types';
import { VoiceInput } from './VoiceInput';
import { saveToProject } from './ProjectsView';
import { SYSTEM_INSTRUCTION_ECOMMERCE } from '../constants';

interface ChatBotProps {
  embedded?: boolean;
  analysisContext?: AnalysisResult | null;
}

export const ChatBot: React.FC<ChatBotProps> = ({ embedded = false, analysisContext }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { 
      role: 'model', 
      text: 'As-salamu alaykum! Main aapka 2026 ka Advanced Business Mentor hun. \n\nAaj ki tareekh **15 February 2026** hai. Market ab 2024 se bohot aage nikal chuki hai. \n\nAgar aap zero se apna Global Brand shuru karna chahte hain jo 2026 ke trends ke mutabik ho, toh puchiye. \n\n(Main Roman Urdu mein jawab dunga).', 
      timestamp: new Date() 
    }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, selectedImage]);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setSelectedImage(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleSend = async () => {
    if ((!input.trim() && !selectedImage) || loading) return;

    const userMsg: ChatMessage = { 
      role: 'user', 
      text: input + (selectedImage ? ' [Image Uploaded]' : ''), 
      timestamp: new Date() 
    };
    
    // Store image in message for display (optional enhancement for future) or just text representation
    setMessages(prev => [...prev, userMsg]);
    
    // Copy image for sending, then clear state
    const imageToSend = selectedImage;
    setSelectedImage(null);
    setInput('');
    setLoading(true);

    try {
      // Format history for API
      const history = messages.map(m => ({
        role: m.role === 'model' ? 'model' : 'user',
        parts: [{ text: m.text }]
      }));

      // Use E-COMMERCE System Instruction with Dynamic Date injection for extra robustness
      // Although constant has it, injecting it here ensures the model stays grounded in every turn if needed.
      const simulatedDate = new Date(); 
      simulatedDate.setFullYear(2026); // Force 2026
      if (simulatedDate.getMonth() < 1) simulatedDate.setMonth(1); // Ensure at least Feb if current month is earlier? 
      // User asked specifically for Feb 15 2026 basis.
      // Let's rely on the Constant, but append context.
      
      let systemInstruction = SYSTEM_INSTRUCTION_ECOMMERCE;
      if (analysisContext) {
        systemInstruction += `\n\nCONTEXT: You also have access to this data analysis: ${JSON.stringify(analysisContext)}`;
      }

      const responseText = await chatWithGemini(history, userMsg.text, systemInstruction, imageToSend);
      
      const botMsg: ChatMessage = { role: 'model', text: responseText || "Maaf kijiye, koi technical masla aa gaya.", timestamp: new Date() };
      setMessages(prev => [...prev, botMsg]);
    } catch (error) {
      console.error(error);
      const errorMsg: ChatMessage = { role: 'model', text: "Connection error. Please try again.", timestamp: new Date() };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveChat = () => {
    const item: SavedItem = {
      id: Date.now().toString(),
      type: 'CHAT',
      title: messages.find(m => m.role === 'user')?.text.substring(0, 30) + '...' || 'Business Guide 2026',
      date: new Date().toLocaleDateString(),
      data: messages,
      tags: ['business', 'affiliate', 'guide', '2026']
    };
    saveToProject(item);
  };

  const containerClass = embedded 
    ? "flex flex-col h-full bg-slate-50 dark:bg-slate-900 rounded-r-xl border-l border-slate-200 dark:border-slate-700" 
    : "p-8 max-w-5xl mx-auto h-screen flex flex-col dark:text-slate-100";

  return (
    <div className={containerClass}>
      {!embedded && (
        <header className="mb-6 flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-black bg-gradient-to-r from-green-500 to-emerald-700 bg-clip-text text-transparent">
              Global Business Expert (2026 Era)
            </h2>
            <p className="text-slate-500 dark:text-slate-400 font-medium">
              Advanced Strategies for Feb 2026 (Roman Urdu)
            </p>
          </div>
          <button 
            onClick={handleSaveChat}
            className="text-sm bg-green-100 text-green-800 border border-green-200 px-3 py-1.5 rounded hover:bg-green-200 transition-colors font-bold"
          >
            💾 Save Guide
          </button>
        </header>
      )}
      
      {embedded && (
        <div className="p-4 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 flex justify-between items-center">
          <div>
            <h3 className="font-bold text-slate-800 dark:text-slate-100">Business Mentor (2026)</h3>
            <p className="text-xs text-green-600 font-bold">● ONLINE</p>
          </div>
          <button onClick={handleSaveChat} title="Save to Project" className="text-slate-400 hover:text-green-500">💾</button>
        </div>
      )}

      <div className={`flex-1 flex flex-col overflow-hidden ${!embedded ? 'bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700' : ''}`}>
        <div className="flex-1 overflow-y-auto p-4 space-y-4" ref={scrollRef}>
          {messages.map((msg, idx) => (
            <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div 
                className={`max-w-[85%] p-4 rounded-2xl text-sm leading-relaxed shadow-sm whitespace-pre-wrap ${
                  msg.role === 'user' 
                    ? 'bg-blue-600 text-white rounded-br-none' 
                    : 'bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 text-slate-800 dark:text-slate-100 rounded-bl-none'
                }`}
              >
                {msg.text}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 p-3 rounded-2xl rounded-bl-none shadow-sm flex gap-2 items-center">
                 <div className="text-xs font-bold text-slate-500 dark:text-slate-300 animate-pulse">Thinking (Roman Urdu)...</div>
              </div>
            </div>
          )}
        </div>
        
        {/* Image Preview Area */}
        {selectedImage && (
          <div className="px-4 py-2 bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700 flex items-center gap-2">
            <div className="relative group">
              <img src={selectedImage} alt="Preview" className="h-16 w-16 object-cover rounded-lg border border-slate-300 dark:border-slate-600" />
              <button 
                onClick={() => setSelectedImage(null)}
                className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs shadow-md"
              >
                ✕
              </button>
            </div>
            <span className="text-xs text-slate-500 italic">Screenshot ready...</span>
          </div>
        )}
        
        <div className="p-3 bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 transition-colors">
          <div className="flex gap-2 items-center">
            {/* Image Upload Button */}
            <input 
              type="file" 
              accept="image/*" 
              ref={fileInputRef} 
              className="hidden" 
              onChange={handleImageSelect}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="p-2 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
              title="Upload Screenshot"
            >
              📷
            </button>

            <VoiceInput onTranscript={(text) => setInput(prev => prev + " " + text)} />
            
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder="Puchiye: 2026 mein kaunsa business best hai?..."
              className="flex-1 border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500"
            />
            <button
              onClick={handleSend}
              disabled={loading || (!input.trim() && !selectedImage)}
              className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 disabled:bg-slate-300 dark:disabled:bg-slate-600 disabled:cursor-not-allowed text-sm font-bold transition-colors shadow-sm"
            >
              Puchein 🚀
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};