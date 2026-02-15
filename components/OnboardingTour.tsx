import React, { useState, useEffect } from 'react';

export const OnboardingTour: React.FC = () => {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const hasSeenTour = localStorage.getItem('wrm_onboarding_completed');
    if (!hasSeenTour) {
      setShow(true);
    }
  }, []);

  const handleClose = () => {
    setShow(false);
    localStorage.setItem('wrm_onboarding_completed', 'true');
  };

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-slate-800 max-w-lg w-full rounded-2xl shadow-2xl overflow-hidden border border-slate-200 dark:border-slate-700 animate-bounce-in">
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-8 text-white text-center">
          <h2 className="text-3xl font-bold mb-2">Welcome to WRM STUDIO!</h2>
          <p className="opacity-90">Your all-in-one creative intelligence suite.</p>
        </div>
        
        <div className="p-8 space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 bg-slate-50 dark:bg-slate-700/50 rounded-xl">
              <span className="text-2xl mb-2 block">📊</span>
              <h3 className="font-bold text-slate-900 dark:text-white">Analytics</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">Deep sentiment analysis & trends.</p>
            </div>
            <div className="p-4 bg-slate-50 dark:bg-slate-700/50 rounded-xl">
              <span className="text-2xl mb-2 block">💬</span>
              <h3 className="font-bold text-slate-900 dark:text-white">AI Chat</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">Ask questions about your data.</p>
            </div>
            <div className="p-4 bg-slate-50 dark:bg-slate-700/50 rounded-xl">
              <span className="text-2xl mb-2 block">🎙️</span>
              <h3 className="font-bold text-slate-900 dark:text-white">Voice Agent</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">Real-time voice roleplay.</p>
            </div>
            <div className="p-4 bg-slate-50 dark:bg-slate-700/50 rounded-xl">
              <span className="text-2xl mb-2 block">🎬</span>
              <h3 className="font-bold text-slate-900 dark:text-white">Veo Studio</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">Generate videos from images.</p>
            </div>
          </div>

          <button
            onClick={handleClose}
            className="w-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold py-3 rounded-xl hover:opacity-90 transition-opacity"
          >
            Get Started
          </button>
        </div>
      </div>
    </div>
  );
};