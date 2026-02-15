import React, { useState, useEffect } from 'react';
import { Navigation } from './components/Navigation';
import { Dashboard } from './components/Dashboard';
import { ChatBot } from './components/ChatBot';
import { VoiceAgent } from './components/VoiceAgent';
import { VideoGenerator } from './components/VideoGenerator';
import { ProjectsView } from './components/ProjectsView';
import { FeedbackWidget } from './components/FeedbackWidget';
import { OnboardingTour } from './components/OnboardingTour';
import { AppView } from './types';

export default function App() {
  const [currentView, setCurrentView] = useState<AppView>(AppView.DASHBOARD);
  const [isLaunched, setIsLaunched] = useState(false);
  
  // Theme State
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('wrm_theme') === 'dark';
    }
    return false;
  });

  // Font State
  const [currentFont, setCurrentFont] = useState(() => {
    return localStorage.getItem('wrm_font') || "'Inter', sans-serif";
  });

  // Apply Theme
  useEffect(() => {
    const html = document.documentElement;
    if (isDarkMode) {
      html.classList.add('dark');
      localStorage.setItem('wrm_theme', 'dark');
    } else {
      html.classList.remove('dark');
      localStorage.setItem('wrm_theme', 'light');
    }
  }, [isDarkMode]);

  // Apply Font
  useEffect(() => {
    document.body.style.fontFamily = currentFont;
    localStorage.setItem('wrm_font', currentFont);
  }, [currentFont]);

  const renderView = () => {
    switch (currentView) {
      case AppView.DASHBOARD:
        return <Dashboard />;
      case AppView.CHAT:
        return <ChatBot />;
      case AppView.VOICE:
        return <VoiceAgent />;
      case AppView.VIDEO:
        return <VideoGenerator />;
      case AppView.PROJECTS:
        return <ProjectsView />;
      default:
        return <Dashboard />;
    }
  };

  if (!isLaunched) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-900 transition-colors p-4 relative overflow-hidden">
        <div className="absolute inset-0 z-0 opacity-10 dark:opacity-20 pointer-events-none">
           <div className="absolute top-10 left-10 text-9xl">📊</div>
           <div className="absolute bottom-20 right-20 text-9xl">🤖</div>
           <div className="absolute top-1/2 left-1/4 text-8xl">🎙️</div>
        </div>
        
        <div className="z-10 text-center space-y-8 animate-fade-in max-w-2xl">
          <div className="space-y-2">
            <h1 className="text-6xl font-black bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 bg-clip-text text-transparent tracking-tight">
              WRM STUDIO
            </h1>
            <p className="text-xl text-slate-600 dark:text-slate-300 font-light tracking-wide">
              Creative Intelligence Suite
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4 text-left bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700">
             <div className="p-3 bg-blue-50 dark:bg-slate-700/50 rounded-lg">
                <div className="text-2xl mb-1">📊</div>
                <div className="font-bold text-slate-800 dark:text-white">Analysis</div>
                <div className="text-xs text-slate-500">Sentiment & Trends</div>
             </div>
             <div className="p-3 bg-indigo-50 dark:bg-slate-700/50 rounded-lg">
                <div className="text-2xl mb-1">🎙️</div>
                <div className="font-bold text-slate-800 dark:text-white">Voice Agent</div>
                <div className="text-xs text-slate-500">Real-time AI Calls</div>
             </div>
             <div className="p-3 bg-purple-50 dark:bg-slate-700/50 rounded-lg">
                <div className="text-2xl mb-1">🎬</div>
                <div className="font-bold text-slate-800 dark:text-white">Veo Studio</div>
                <div className="text-xs text-slate-500">Video Generation</div>
             </div>
             <div className="p-3 bg-emerald-50 dark:bg-slate-700/50 rounded-lg">
                <div className="text-2xl mb-1">💬</div>
                <div className="font-bold text-slate-800 dark:text-white">AI Chat</div>
                <div className="text-xs text-slate-500">Deep Insights</div>
             </div>
          </div>

          <button
            onClick={() => setIsLaunched(true)}
            className="group relative inline-flex items-center justify-center px-8 py-4 text-lg font-bold text-white transition-all duration-200 bg-slate-900 font-pj rounded-xl focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-900 dark:bg-white dark:text-slate-900 hover:scale-105 shadow-lg"
          >
            <span className="mr-2 text-2xl group-hover:animate-bounce">🚀</span>
            Launch Application
          </button>
        </div>
        
        <div className="absolute bottom-6 text-slate-400 text-sm">
          Powered by Google Gemini 2.0 & Veo
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-900 transition-colors duration-300">
      <Navigation 
        currentView={currentView} 
        onNavigate={setCurrentView}
        isDarkMode={isDarkMode}
        toggleTheme={() => setIsDarkMode(!isDarkMode)}
        currentFont={currentFont}
        setFont={setCurrentFont}
      />
      <main className="ml-64 flex-1 overflow-y-auto h-screen">
        {renderView()}
      </main>
      
      <FeedbackWidget />
      <OnboardingTour />
    </div>
  );
}