import React, { useState } from 'react';

export const FeedbackWidget: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!feedback.trim()) return;
    
    // Simulate logging
    console.log("Feedback submitted:", feedback);
    setSubmitted(true);
    
    setTimeout(() => {
      setIsOpen(false);
      setSubmitted(false);
      setFeedback('');
    }, 2000);
  };

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {!isOpen ? (
        <button
          onClick={() => setIsOpen(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white h-10 w-10 rounded-full shadow-lg transition-transform hover:scale-110 flex items-center justify-center opacity-80 hover:opacity-100"
          title="Send Feedback"
        >
          <span className="text-sm">💬</span>
        </button>
      ) : (
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-6 w-72 border border-slate-200 dark:border-slate-700 animate-fade-in absolute bottom-12 right-0">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-bold text-slate-900 dark:text-white text-sm">Feedback</h3>
            <button 
              onClick={() => setIsOpen(false)}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              ✕
            </button>
          </div>
          
          {submitted ? (
            <div className="text-center py-4">
              <div className="text-2xl mb-2">✅</div>
              <p className="text-slate-600 dark:text-slate-300 text-xs font-medium">Shukriya!</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="Koi masla ya mashwara?..."
                className="w-full h-24 p-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-xs focus:ring-2 focus:ring-blue-500 mb-3 dark:text-white resize-none"
                autoFocus
              />
              <button
                type="submit"
                disabled={!feedback.trim()}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-600 text-white font-bold py-2 rounded-lg transition-colors text-xs"
              >
                Bhejein
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
};