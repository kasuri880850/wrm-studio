import React, { useState, useEffect } from 'react';
import { Project, SavedItem } from '../types';

export const ProjectsView: React.FC = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [newProjectName, setNewProjectName] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('wrm_projects');
    if (saved) {
      try {
        setProjects(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to load projects", e);
      }
    }
  }, []);

  const saveProjects = (updated: Project[]) => {
    setProjects(updated);
    localStorage.setItem('wrm_projects', JSON.stringify(updated));
  };

  const createProject = () => {
    if (!newProjectName.trim()) return;
    const newProject: Project = {
      id: Date.now().toString(),
      name: newProjectName,
      description: 'New Project',
      createdAt: new Date().toLocaleDateString(),
      items: []
    };
    saveProjects([...projects, newProject]);
    setNewProjectName('');
    setIsCreating(false);
  };

  const deleteProject = (id: string) => {
    if (confirm("Are you sure you want to delete this project?")) {
      saveProjects(projects.filter(p => p.id !== id));
    }
  };

  const deleteItem = (projectId: string, itemId: string) => {
    const updated = projects.map(p => {
      if (p.id === projectId) {
        return { ...p, items: p.items.filter(i => i.id !== itemId) };
      }
      return p;
    });
    saveProjects(updated);
  };

  return (
    <div className="p-8 max-w-6xl mx-auto dark:text-slate-100">
      <header className="mb-8 flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Project Management</h2>
          <p className="text-slate-500 dark:text-slate-400">Organize your analysis, chats, and videos.</p>
        </div>
        <button
          onClick={() => setIsCreating(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium shadow-sm transition-colors"
        >
          + New Project
        </button>
      </header>

      {isCreating && (
        <div className="mb-8 bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 animate-fade-in flex gap-4 items-center">
          <input
            type="text"
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            placeholder="Project Name"
            className="flex-1 px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700"
          />
          <button onClick={createProject} className="bg-green-600 text-white px-4 py-2 rounded-lg">Save</button>
          <button onClick={() => setIsCreating(false)} className="bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 px-4 py-2 rounded-lg">Cancel</button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-8">
        {projects.length === 0 ? (
          <div className="text-center py-20 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-700">
            <div className="text-4xl mb-4">📂</div>
            <p className="text-slate-500 dark:text-slate-400">No projects yet. Create one to get started!</p>
          </div>
        ) : (
          projects.map(project => (
            <div key={project.id} className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
              <div className="p-4 bg-slate-50 dark:bg-slate-700/50 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold">
                    {project.name.substring(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <h3 className="font-bold text-lg">{project.name}</h3>
                    <p className="text-xs text-slate-500">Created: {project.createdAt} • {project.items.length} Items</p>
                  </div>
                </div>
                <button onClick={() => deleteProject(project.id)} className="text-slate-400 hover:text-red-500 transition-colors p-2">🗑️</button>
              </div>

              <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {project.items.length === 0 && (
                  <p className="col-span-full text-center text-slate-400 py-8 italic text-sm">Empty project.</p>
                )}
                {project.items.map(item => (
                  <div key={item.id} className="p-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 hover:border-blue-300 dark:hover:border-blue-500 transition-colors relative group">
                    <div className="flex justify-between items-start mb-2">
                       <span className="text-xs font-bold px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                         {item.type}
                       </span>
                       <span className="text-[10px] text-slate-400">{item.date}</span>
                    </div>
                    <h4 className="font-medium truncate mb-2" title={item.title}>{item.title}</h4>
                    
                    {item.type === 'VIDEO' && (
                       <div className="aspect-video bg-black rounded mb-2 flex items-center justify-center">
                          <span className="text-2xl">🎬</span>
                       </div>
                    )}
                    {item.type === 'ANALYSIS' && (
                       <div className="text-xs text-slate-500 line-clamp-2 bg-white dark:bg-slate-800 p-2 rounded">
                         {JSON.stringify(item.data.summary?.title || "Analysis Data")}
                       </div>
                    )}

                    <div className="flex flex-wrap gap-1 mt-2">
                      {item.tags?.map(tag => (
                        <span key={tag} className="text-[10px] bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded">#{tag}</span>
                      ))}
                    </div>

                    <button 
                      onClick={() => deleteItem(project.id, item.id)}
                      className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs transition-opacity"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

// Helper function to save items (to be used by other components)
export const saveToProject = (item: SavedItem, projectName?: string) => {
  const projectsStr = localStorage.getItem('wrm_projects');
  let projects: Project[] = projectsStr ? JSON.parse(projectsStr) : [];
  
  // Default to a "General" project if none exists or specified
  let targetProject = projectName 
    ? projects.find(p => p.name === projectName) 
    : projects[0];
  
  if (!targetProject) {
    targetProject = {
      id: Date.now().toString(),
      name: projectName || 'General',
      description: 'Default Project',
      createdAt: new Date().toLocaleDateString(),
      items: []
    };
    projects.push(targetProject);
  }

  // Add item
  targetProject.items.unshift(item);
  
  // Update storage
  const updatedProjects = projects.map(p => p.id === targetProject!.id ? targetProject! : p);
  localStorage.setItem('wrm_projects', JSON.stringify(updatedProjects));
  
  alert(`Saved to project: ${targetProject.name}`);
};