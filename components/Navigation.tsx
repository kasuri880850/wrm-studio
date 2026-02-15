import React from 'react';
import { AppView } from '../types';

interface NavigationProps {
  currentView: AppView;
  onNavigate: (view: AppView) => void;
  isDarkMode: boolean;
  toggleTheme: () => void;
  currentFont: string;
  setFont: (font: string) => void;
}

export const Navigation: React.FC<NavigationProps> = ({ 
  currentView, 
  onNavigate, 
  isDarkMode, 
  toggleTheme,
  currentFont,
  setFont
}) => {
  const navItems = [
    { id: AppView.DASHBOARD, label: 'Dashboard', icon: '📊' },
    { id: AppView.CHAT, label: 'AI Chat', icon: '💬' },
    { id: AppView.VOICE, label: 'Voice Agent', icon: '🎙️' },
    { id: AppView.VIDEO, label: 'Veo Studio', icon: '🎬' },
    { id: AppView.PROJECTS, label: 'Projects', icon: '📂' },
  ];

  const fonts = [
    { name: 'Inter', value: "'Inter', sans-serif" },
    { name: 'Roboto', value: "'Roboto', sans-serif" },
    { name: 'Serif', value: "'Playfair Display', serif" },
    { name: 'Mono', value: "'Fira Code', monospace" },
  ];

  return (
    <nav className="w-64 bg-white dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 h-screen flex flex-col fixed left-0 top-0 z-10 transition-colors duration-300">
      <div className="p-6 border-b border-slate-100 dark:border-slate-700">
        <h1 className="text-xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent tracking-tight">
          WRM STUDIO
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Creative Intelligence Suite</p>
      </div>
      
      <div className="flex-1 py-6 space-y-1">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={`w-full flex items-center px-6 py-3 text-sm font-medium transition-colors ${
              currentView === item.id
                ? 'text-blue-600 bg-blue-50 dark:bg-slate-700/50 border-r-2 border-blue-600 dark:text-blue-400'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
            }`}
          >
            <span className="mr-3 text-lg">{item.icon}</span>
            {item.label}
          </button>
        ))}
      </div>

      {/* Settings Section */}
      <div className="p-6 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 space-y-4">
        <div>
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Theme</label>
          <button 
            onClick={toggleTheme}
            className="w-full flex items-center justify-between px-3 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors"
          >
            <span>{isDarkMode ? '🌙 Dark Mode' : '☀️ Light Mode'}</span>
          </button>
        </div>
        
        <div>
           <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Typography</label>
           <select 
             value={currentFont}
             onChange={(e) => setFont(e.target.value)}
             className="w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-sm text-slate-700 dark:text-slate-200 outline-none focus:ring-1 focus:ring-blue-500"
           >
             {fonts.map(f => (
               <option key={f.name} value={f.value}>{f.name}</option>
             ))}
           </select>
        </div>
      </div>
    </nav>
  );
};