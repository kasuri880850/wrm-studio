import React, { useState, useRef, useEffect, useCallback } from 'react';
import { generateVeoVideo, generateSpeech, generateCreativeScript } from '../services/geminiService';
import { VoiceInput } from './VoiceInput';
import { saveToProject } from './ProjectsView';
import { SavedItem } from '../types';
// @ts-ignore
import JSZip from 'jszip'; 

const STYLE_PRESETS = [
  'None',
  'Cinematic',
  'Anime',
  'Cyberpunk',
  'Vintage/Retro',
  '3D Render',
  'Watercolor',
  'Claymation',
  'Photorealistic'
];

type TransitionType = 'cut' | 'fade' | 'slide';

interface VideoScene {
  id: string;
  url: string;
  asset: any;
  prompt: string;
  duration: number; // approximate duration in seconds
  transition: TransitionType; // Transition TO this scene (or from previous)
  audioUrl?: string; // Voiceover/Music for this scene
  audioScript?: string; // The text script generated for audio
  mergedUrl?: string; // Combined Video + Audio
  isMerging?: boolean;
}

// Optimized Sync Merging
const mergeVideoAudio = async (videoUrl: string, audioUrl: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    // Create elements
    const video = document.createElement('video');
    video.muted = true; // Crucial for auto-play permissions
    video.crossOrigin = 'anonymous';
    
    // Create AudioContext
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const dest = audioCtx.createMediaStreamDestination();
    
    video.src = videoUrl;

    video.onerror = () => reject(new Error("Failed to load video source"));

    // We wait for metadata to ensure we can capture the stream
    video.onloadedmetadata = async () => {
      try {
        // Fetch and Decode Audio
        const audioResp = await fetch(audioUrl);
        const audioData = await audioResp.arrayBuffer();
        const audioBuffer = await audioCtx.decodeAudioData(audioData);
        
        const source = audioCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(dest);
        
        // Capture Video Stream
        // @ts-ignore
        const videoStream = (video.captureStream || video.mozCaptureStream).call(video);
        
        // Combine Tracks: Video from element, Audio from context destination
        const combinedStream = new MediaStream([
            ...videoStream.getVideoTracks(),
            ...dest.stream.getAudioTracks()
        ]);
        
        // Setup Recorder
        let mimeType = 'video/webm;codecs=vp9';
        if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'video/webm';
        
        const recorder = new MediaRecorder(combinedStream, { mimeType, videoBitsPerSecond: 5000000 });
        const chunks: Blob[] = [];
        
        recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
        
        recorder.onstop = () => {
            const blob = new Blob(chunks, { type: mimeType });
            resolve(URL.createObjectURL(blob));
            // Cleanup
            video.remove();
            audioCtx.close();
        };
        
        // SYNC LOGIC: Wait for video to be ready to play through to avoid stutter
        video.oncanplaythrough = async () => {
             // Remove handler to avoid double firing
             video.oncanplaythrough = null;
             
             try {
                // Start recorder first
                recorder.start();
                
                // Trigger both playback sources simultaneously
                // We use a small delay or Promise.all to align them as closely as possible
                await Promise.all([
                    video.play(),
                    // Start audio immediately (offset 0)
                    (source.start ? source.start(0) : (source as any).noteOn(0))
                ]);
                
             } catch (err) {
                 reject(err);
                 recorder.stop();
             }
        };

        // Stop recording exactly when video ends
        video.onended = () => {
            if (recorder.state !== 'inactive') recorder.stop();
        };
        
        // Explicitly load if not auto-triggered
        video.load();

      } catch (e) {
        reject(e);
      }
    };
  });
};

export const VideoGenerator: React.FC = () => {
  // Inputs
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  
  // Generation State
  const [isGenerating, setIsGenerating] = useState(false);
  const [isAutoGenerating, setIsAutoGenerating] = useState(false); 
  const [autoGenCount, setAutoGenCount] = useState<number>(3); 
  const [isAutoAudio, setIsAutoAudio] = useState(false); 
  const stopAutoGenerationRef = useRef(false);

  // Cooldown State for 429 management
  const [coolDown, setCoolDown] = useState(0);

  // Timeline / Story State
  const [timeline, setTimeline] = useState<VideoScene[]>([]);
  const [selectedSceneIds, setSelectedSceneIds] = useState<Set<string>>(new Set());
  const [activeSceneIndex, setActiveSceneIndex] = useState<number>(0);
  const [isPlayingAll, setIsPlayingAll] = useState(false);
  
  // Settings
  const [activeTab, setActiveTab] = useState<'basic' | 'advanced'>('basic');
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16'>('16:9');
  const [resolution, setResolution] = useState<'720p' | '1080p'>('720p');
  const [frameRate, setFrameRate] = useState<number>(24);
  const [sceneDuration, setSceneDuration] = useState<number>(8); // Default target for NEW scenes
  const [stylePreset, setStylePreset] = useState<string>('None');
  const [motionIntensity, setMotionIntensity] = useState<number>(5);
  const [consistency, setConsistency] = useState<number>(5);
  const [outputFormat, setOutputFormat] = useState<'MP4' | 'GIF'>('MP4');
  const [characterLock, setCharacterLock] = useState<boolean>(true);
  const [isLooping, setIsLooping] = useState(false);
  const [seed, setSeed] = useState<number | undefined>(undefined);

  // Audio & Voiceover State
  const [voiceText, setVoiceText] = useState('');
  const [voiceName, setVoiceName] = useState('Kore');
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
  const [videoVolume, setVideoVolume] = useState<number>(1.0);
  const [voiceVolume, setVoiceVolume] = useState<number>(1.0);
  
  // Export Modal
  const [showExportModal, setShowExportModal] = useState(false);
  const [isZipping, setIsZipping] = useState(false);

  // Error State
  const [error, setError] = useState<string | null>(null);
  const [isApiKeyError, setIsApiKeyError] = useState(false);
  const [isSafetyError, setIsSafetyError] = useState(false);
  const [isQuotaError, setIsQuotaError] = useState(false);

  // Refs for seamless playback
  const videoPlayerARef = useRef<HTMLVideoElement>(null);
  const videoPlayerBRef = useRef<HTMLVideoElement>(null);
  const audioPlayerRef = useRef<HTMLAudioElement>(null);
  const [activePlayer, setActivePlayer] = useState<'A' | 'B'>('A');
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [transitionType, setTransitionType] = useState<TransitionType>('cut');

  // --- Handlers ---

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setSelectedImage(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleSelectKey = async () => {
    // @ts-ignore
    if (window.aistudio && window.aistudio.openSelectKey) {
      // @ts-ignore
      await window.aistudio.openSelectKey();
      setError(null);
      setIsApiKeyError(false);
      setIsQuotaError(false);
      setCoolDown(0); // Reset cooldown on key change
    }
  };

  const clearTimeline = () => {
    if (confirm("Are you sure? This will clear all generated scenes.")) {
      setTimeline([]);
      setSelectedSceneIds(new Set());
      setActiveSceneIndex(0);
      setPrompt('');
      setError(null);
    }
  };

  const toggleSceneSelection = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setSelectedSceneIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Cooldown Timer
  useEffect(() => {
    if (coolDown > 0) {
        const timer = setInterval(() => {
            setCoolDown(c => Math.max(0, c - 1));
        }, 1000);
        return () => clearInterval(timer);
    }
  }, [coolDown]);

  const currentScene = timeline[activeSceneIndex];
  
  const handleDurationChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value);
    setSceneDuration(val);
    
    // If a scene is currently active, update its duration directly
    if (timeline.length > 0) {
        setTimeline(prev => prev.map((s, i) => i === activeSceneIndex ? { ...s, duration: val } : s));
    }
  };

  const handleSaveProject = () => {
    if (timeline.length === 0) return;
    const item: SavedItem = {
      id: Date.now().toString(),
      type: 'VIDEO',
      title: `Cinematic Story (${timeline.length} Scenes)`,
      date: new Date().toLocaleDateString(),
      data: { timeline, settings: { stylePreset, motionIntensity, characterLock } },
      tags: ['video', 'story', `scenes:${timeline.length}`]
    };
    saveToProject(item);
  };

  const handleDownloadActiveVideo = async () => {
      const scene = timeline[activeSceneIndex];
      if (!scene) return;
      
      // PRIORITIZE MERGED URL
      const downloadUrl = scene.mergedUrl || scene.url;
      const ext = scene.mergedUrl ? 'webm' : 'mp4';
      const num = (activeSceneIndex + 1).toString().padStart(2, '0');
      
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `scene_${num}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
  };

  const handleDownloadScene = async (e: React.MouseEvent, scene: VideoScene, index: number) => {
    e.stopPropagation();
    // PRIORITIZE MERGED URL
    const downloadUrl = scene.mergedUrl || scene.url;
    const ext = scene.mergedUrl ? 'webm' : 'mp4';
    const num = (index + 1).toString().padStart(2, '0');
    
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = `scene_${num}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleDownloadProjectZip = async () => {
    if (timeline.length === 0) return;
    setIsZipping(true);

    try {
        const { default: JSZip } = await import('jszip');
        const zip = new JSZip();

        const scenesToExport = selectedSceneIds.size > 0 
           ? timeline.filter(s => selectedSceneIds.has(s.id))
           : timeline;

        let fileListText = "";
        
        for (let i = 0; i < scenesToExport.length; i++) {
            const scene = scenesToExport[i];
            const num = (i + 1).toString().padStart(2, '0');
            
            const vRes = await fetch(scene.url);
            const vBlob = await vRes.blob();
            zip.file(`scene_${num}_video.mp4`, vBlob);

            if (scene.audioUrl) {
                const aRes = await fetch(scene.audioUrl);
                const aBlob = await aRes.blob();
                zip.file(`scene_${num}_audio.wav`, aBlob);
                fileListText += `file 'scene_${num}_final.mp4'\n`;
            } else {
                fileListText += `file 'scene_${num}_video.mp4'\n`;
            }
            
            if (scene.mergedUrl) {
               const mRes = await fetch(scene.mergedUrl);
               const mBlob = await mRes.blob();
               zip.file(`scene_${num}_merged.webm`, mBlob);
            }
        }

        const winScript = `
@echo off
mkdir merged_scenes 2>nul
${scenesToExport.map((s, i) => {
  const num = (i + 1).toString().padStart(2, '0');
  return s.audioUrl 
    ? `ffmpeg -i scene_${num}_video.mp4 -i scene_${num}_audio.wav -c:v copy -c:a aac -map 0:v:0 -map 1:a:0 -shortest scene_${num}_final.mp4` 
    : `REM No audio scene ${num}`;
}).join('\n')}
(
${scenesToExport.map((s, i) => {
    const num = (i + 1).toString().padStart(2, '0');
    return s.audioUrl ? `echo file 'scene_${num}_final.mp4'` : `echo file 'scene_${num}_video.mp4'`;
}).join('\n')}
) > list.txt
ffmpeg -f concat -safe 0 -i list.txt -c copy full_movie_final.mp4
pause
        `;

        zip.file("merge_movie.bat", winScript);
        zip.file("list.txt", fileListText);

        const content = await zip.generateAsync({ type: "blob" });
        const saveLink = document.createElement("a");
        saveLink.href = URL.createObjectURL(content);
        saveLink.download = selectedSceneIds.size > 0 ? "wrm_studio_selection.zip" : "wrm_studio_full_project.zip";
        saveLink.click();

    } catch (e: any) {
        console.error("Zip failed", e);
        setError("Failed to zip files. " + e.message);
    } finally {
        setIsZipping(false);
    }
  };

  // --- Audio Logic ---
  const handleGenerateVoiceover = async (useAutoScript: boolean = false) => {
    let textToSpeak = voiceText;
    setIsGeneratingAudio(true);
    let sceneIndex = activeSceneIndex;
    
    if (timeline.length === 0) {
       setError("Generate a video scene first to attach audio to.");
       setIsGeneratingAudio(false);
       return;
    }

    try {
      if (useAutoScript) {
         const currentScene = timeline[sceneIndex];
         textToSpeak = await generateCreativeScript(currentScene.prompt, stylePreset);
         setVoiceText(textToSpeak); 
      }

      if (!textToSpeak.trim()) {
         setIsGeneratingAudio(false);
         return;
      }

      const audioUrl = await generateSpeech(textToSpeak, voiceName);
      
      // Update state with audio
      setTimeline(prev => prev.map((s, i) => i === sceneIndex ? { ...s, audioUrl, audioScript: textToSpeak, isMerging: true } : s));

      const currentVideo = timeline[sceneIndex];
      try {
         // USE NEW ROBUST MERGE
         const mergedUrl = await mergeVideoAudio(currentVideo.url, audioUrl);
         setTimeline(prev => prev.map((s, i) => i === sceneIndex ? { ...s, mergedUrl, isMerging: false } : s));
      } catch (mergeErr) {
         console.error("Merge failed", mergeErr);
         setTimeline(prev => prev.map((s, i) => i === sceneIndex ? { ...s, isMerging: false } : s));
      }

    } catch (e: any) {
      console.error(e);
      setError("Audio generation failed: " + e.message);
      if (e.message.includes('429')) {
          setIsQuotaError(true);
          setCoolDown(30); // 30s cooldown for Audio
      }
    } finally {
      setIsGeneratingAudio(false);
    }
  };

  // --- Generation Logic ---

  const executeGeneration = async (isChain: boolean = false) => {
    setError(null);
    setIsApiKeyError(false);
    setIsSafetyError(false);
    setIsQuotaError(false);
    setIsGenerating(true);

    try {
      // @ts-ignore
      if (window.aistudio && window.aistudio.hasSelectedApiKey) {
        // @ts-ignore
        const hasKey = await window.aistudio.hasSelectedApiKey();
        if (!hasKey) {
            // @ts-ignore
            await window.aistudio.openSelectKey();
        }
      }

      const lastScene = timeline.length > 0 ? timeline[timeline.length - 1] : null;
      const isExtension = !!lastScene;
      let enhancedPrompt = prompt;
      
      if (isExtension && !enhancedPrompt.trim() && isChain) {
        enhancedPrompt = "Continue the action naturally, maintaining visual consistency.";
      }
      
      if (!isExtension && !selectedImage && !enhancedPrompt.trim()) {
        throw new Error("Please provide an image or a prompt to start.");
      }

      if (motionIntensity > 7) enhancedPrompt += " with high speed dynamic motion";
      if (consistency > 7) enhancedPrompt += ", strictly adhering to visual details";
      if (outputFormat === 'GIF') enhancedPrompt += ", looped seamlessly";

      const result = await generateVeoVideo(
        enhancedPrompt, 
        isExtension ? null : selectedImage, 
        aspectRatio, 
        resolution, 
        frameRate, 
        stylePreset,
        characterLock,
        isExtension ? lastScene.asset : undefined,
        seed
      );

      const newScene: VideoScene = {
        id: Date.now().toString(),
        url: result.url,
        asset: result.asset,
        prompt: enhancedPrompt,
        duration: sceneDuration, 
        transition: 'cut' 
      };

      setTimeline(prev => {
        const updated = [...prev, newScene];
        setActiveSceneIndex(updated.length - 1); 
        return updated;
      });

      if (isAutoAudio) {
         (async () => {
             try {
               const narrationScript = await generateCreativeScript(enhancedPrompt, stylePreset);
               const speechUrl = await generateSpeech(narrationScript, voiceName);
               
               // Mark as merging
               setTimeline(prev => prev.map(s => s.id === newScene.id ? { ...s, audioUrl: speechUrl, audioScript: narrationScript, isMerging: true } : s));
               
               // Perform Sync Merge
               const mergedUrl = await mergeVideoAudio(result.url, speechUrl);
               
               setTimeline(prev => prev.map(s => s.id === newScene.id ? { ...s, mergedUrl, isMerging: false } : s));
             } catch (audioErr: any) {
                console.warn("Auto-audio/merge failed", audioErr);
                setTimeline(prev => prev.map(s => s.id === newScene.id ? { ...s, isMerging: false } : s));
             }
         })();
      }

      return true;

    } catch (err: any) {
      console.error("Generation Error:", err);
      let errorMessage = err.message || "Video generation failed.";
      
      // Try to parse if it looks like JSON (common for 429 quota errors)
      if (typeof errorMessage === 'string' && errorMessage.trim().startsWith('{')) {
        try {
           const parsed = JSON.parse(errorMessage);
           if (parsed.error && parsed.error.message) errorMessage = parsed.error.message;
        } catch(e) {}
      }
      
      if (errorMessage.includes("safety filters")) {
          setIsSafetyError(true);
      } else if (errorMessage.includes("Video generation failed or returned no URI")) {
          errorMessage = "Video generation failed. The content may have been filtered or could not be processed. Please try a different prompt or image.";
      }

      if (errorMessage.includes("429") || errorMessage.includes("quota") || errorMessage.includes("RESOURCE_EXHAUSTED")) {
          // Robust feedback for Quota
          errorMessage = "Quota Limit Reached. The system is backing off to let your quota reset. Please wait...";
          setIsQuotaError(true);
          setCoolDown(60); 
      }
      
      // Strict Auth Check
      if (
        errorMessage.includes("Requested entity was not found") || 
        errorMessage.includes("API key") || 
        errorMessage.includes("403") ||
        errorMessage.includes("PERMISSION_DENIED") ||
        errorMessage.includes("billing")
      ) {
         errorMessage = "Access Denied. Your API key may be invalid, missing, or lack Veo billing access.";
         setIsApiKeyError(true);
      }
      setError(errorMessage);
      return false;
    } finally {
      setIsGenerating(false);
    }
  };

  const handleStartGeneration = async () => {
    if (coolDown > 0) return; // Prevent start if cooling down

    stopAutoGenerationRef.current = false;
    if (!isAutoGenerating) {
      await executeGeneration();
    } else {
      let count = 0;
      let keepGoing = true;
      while (keepGoing && !stopAutoGenerationRef.current && count < autoGenCount) {
        const success = await executeGeneration(true);
        if (!success) {
            // If failed due to error, loop will naturally break, but we need to respect cooldown
            break;
        }
        count++;
        
        // Throttling: Wait 5s between successful generations to respect quota
        if (count < autoGenCount && !stopAutoGenerationRef.current) {
            await new Promise(resolve => setTimeout(resolve, 5000));
        }

        if (count >= autoGenCount || stopAutoGenerationRef.current) keepGoing = false;
      }
      setIsAutoGenerating(false); 
    }
  };

  const handleStopAuto = () => {
    stopAutoGenerationRef.current = true;
    setIsAutoGenerating(false);
  };

  // --- Playback Logic ---

  const handlePlayAll = () => {
    if (timeline.length === 0) return;
    setIsPlayingAll(true);
    setActiveSceneIndex(0);
    setActivePlayer('A');
    setIsTransitioning(false);
  };

  // Callback to move to next scene
  const handleSceneEnd = useCallback(() => {
    if (isPlayingAll) {
      if (activeSceneIndex < timeline.length - 1) {
        const nextIndex = activeSceneIndex + 1;
        const nextScene = timeline[nextIndex];
        setTransitionType(nextScene.transition);
        if (nextScene.transition !== 'cut') {
           setIsTransitioning(true);
           setTimeout(() => {
              setActiveSceneIndex(nextIndex);
              setActivePlayer(prev => prev === 'A' ? 'B' : 'A');
              setIsTransitioning(false);
           }, 800); 
        } else {
           setActiveSceneIndex(nextIndex);
           setActivePlayer(prev => prev === 'A' ? 'B' : 'A');
        }
      } else {
        if (isLooping) {
          setActiveSceneIndex(0);
          setActivePlayer(prev => prev === 'A' ? 'B' : 'A');
        } else {
          setIsPlayingAll(false);
          setIsTransitioning(false);
        }
      }
    } else if (isLooping) {
       const player = activePlayer === 'A' ? videoPlayerARef.current : videoPlayerBRef.current;
       player?.play();
    }
  }, [activeSceneIndex, isPlayingAll, isLooping, timeline, activePlayer]);

  useEffect(() => {
    const scene = timeline[activeSceneIndex];
    if (!scene) return;
    // ALWAYS USE MERGED URL IF AVAILABLE
    const currentUrl = scene.mergedUrl || scene.url;
    
    const playerA = videoPlayerARef.current;
    const playerB = videoPlayerBRef.current;
    const currentPlayer = activePlayer === 'A' ? playerA : playerB;
    const audioPlayer = audioPlayerRef.current;

    if (isPlayingAll) {
       if (currentPlayer && currentUrl) {
          if (currentPlayer.src !== new URL(currentUrl, window.location.href).href) {
             currentPlayer.src = currentUrl;
          }
          currentPlayer.volume = videoVolume;
          // In movie mode, we use a timer to enforce duration, so loop the video 
          // to prevent it from stopping if duration > video length
          currentPlayer.loop = true; 
          currentPlayer.play().catch(e => console.log("Autoplay blocked", e));
       }
    } else {
      if (playerA && currentUrl) {
         if (playerA.src !== new URL(currentUrl, window.location.href).href) {
             playerA.src = currentUrl;
         }
         playerA.volume = videoVolume;
         playerA.loop = isLooping; // Respect global single clip loop setting
      }
    }
    
    // Only use separate audio player if we do NOT have a merged URL
    if (audioPlayer) {
       const audioUrl = scene.audioUrl;
       const isMergedPlaying = !!scene.mergedUrl;
       if (audioUrl && !isMergedPlaying) {
          if (audioPlayer.src !== audioUrl) audioPlayer.src = audioUrl;
          audioPlayer.volume = voiceVolume;
          if (isPlayingAll) audioPlayer.play().catch(e => console.log("Audio blocked", e));
       } else {
          audioPlayer.pause();
       }
    }

    // DURATION CONTROL: Use timeout for movie playback mode
    let transitionTimer: NodeJS.Timeout;
    if (isPlayingAll) {
        const durationMs = (scene.duration || 5) * 1000;
        transitionTimer = setTimeout(() => {
            handleSceneEnd();
        }, durationMs);
    }

    return () => clearTimeout(transitionTimer);

  }, [activeSceneIndex, activePlayer, isPlayingAll, timeline, videoVolume, voiceVolume, isLooping, handleSceneEnd]); 

  const toggleTransition = (index: number) => {
     const types: TransitionType[] = ['cut', 'fade', 'slide'];
     setTimeline(prev => prev.map((s, i) => {
        if (i === index) {
            const currentIdx = types.indexOf(s.transition);
            const nextType = types[(currentIdx + 1) % types.length];
            return { ...s, transition: nextType };
        }
        return s;
     }));
  };
  
  const getPlayerClasses = (player: 'A' | 'B') => {
      const base = "absolute inset-0 w-full h-full object-contain transition-all duration-700 ease-in-out";
      const isActive = activePlayer === player;
      if (!isTransitioning) return isActive ? `${base} opacity-100 z-10` : `${base} opacity-0 z-0`;
      if (transitionType === 'fade') return isActive ? `${base} opacity-0 z-0` : `${base} opacity-100 z-10`; 
      if (transitionType === 'slide') return isActive ? `${base} -translate-x-full z-10` : `${base} translate-x-0 z-20`; 
      return `${base} opacity-100`;
  };

  const generateFFmpegScript = () => {
    return `
# See the "merge_movie" scripts inside the downloaded ZIP for automatic processing.
ffmpeg -f concat -safe 0 -i list.txt -c copy final.mp4
    `.trim();
  };

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto dark:text-slate-100 pb-20">
      
      {/* Header */}
      <header className="mb-8 flex justify-between items-end">
        <div>
          <h2 className="text-3xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            🎬 Veo Cinematic Studio
          </h2>
          <p className="text-slate-500 dark:text-slate-400 mt-1">
            Multi-Character Auto-Sense Scripting & Intelligent Merging.
          </p>
        </div>
        <div className="flex gap-2 text-sm">
           <div className="bg-blue-50 dark:bg-slate-800 px-3 py-1 rounded-full border border-blue-100 dark:border-slate-700">
             Total: <strong>{timeline.reduce((acc, s) => acc + (s.duration || 5), 0)}s</strong>
           </div>
           <div className="bg-purple-50 dark:bg-slate-800 px-3 py-1 rounded-full border border-purple-100 dark:border-slate-700">
             Scenes: <strong>{timeline.length}</strong>
           </div>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* LEFT COLUMN */}
        <div className="lg:col-span-4 space-y-6">
           <div className="bg-white dark:bg-slate-800 p-5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
              <div className="flex justify-between items-center mb-2">
                 <label className="text-sm font-bold text-slate-700 dark:text-slate-300">
                   {timeline.length > 0 ? `Next Scene (Extending Scene ${timeline.length})` : 'Start New Movie'}
                 </label>
                 <VoiceInput onTranscript={(text) => setPrompt(prev => prev + " " + text)} />
              </div>
              
              {timeline.length === 0 && (
                <div className="mb-4">
                  {!selectedImage ? (
                    <div className="relative border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg p-4 text-center hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors cursor-pointer">
                        <input type="file" accept="image/*" onChange={handleImageUpload} className="absolute inset-0 opacity-0 cursor-pointer" />
                        <span className="text-2xl block mb-1">🖼️</span>
                        <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">Upload Start Image</span>
                    </div>
                  ) : (
                    <div className="relative group rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700">
                       <img src={selectedImage} alt="Start" className="w-full h-32 object-cover" />
                       <button onClick={() => setSelectedImage(null)} className="absolute top-1 right-1 bg-black/50 text-white rounded-full p-1 text-xs opacity-0 group-hover:opacity-100 transition-opacity">✕</button>
                    </div>
                  )}
                </div>
              )}

              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={timeline.length > 0 
                  ? "What happens next? (e.g., 'The camera zooms in', 'He turns around')" 
                  : "Describe your movie opening..."
                }
                className="w-full h-24 border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 bg-slate-50 dark:bg-slate-900 text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none"
              />
           </div>

           {/* SETTINGS */}
           <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
              <div className="flex border-b border-slate-200 dark:border-slate-700">
                 <button onClick={() => setActiveTab('basic')} className={`flex-1 py-3 text-xs font-bold uppercase ${activeTab === 'basic' ? 'bg-slate-50 dark:bg-slate-700 text-blue-600' : 'text-slate-500'}`}>Basic</button>
                 <button onClick={() => setActiveTab('advanced')} className={`flex-1 py-3 text-xs font-bold uppercase ${activeTab === 'advanced' ? 'bg-slate-50 dark:bg-slate-700 text-blue-600' : 'text-slate-500'}`}>Advanced</button>
              </div>

              <div className="p-5 space-y-4">
                 {activeTab === 'basic' && (
                    <div className="animate-fade-in space-y-4">
                       <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Ratio</label>
                            <div className="flex bg-slate-100 dark:bg-slate-700 rounded p-1">
                               {['16:9', '9:16'].map(r => (
                                 <button key={r} onClick={() => setAspectRatio(r as any)} className={`flex-1 text-xs py-1 rounded ${aspectRatio === r ? 'bg-white dark:bg-slate-600 shadow-sm text-blue-600' : 'text-slate-500'}`}>{r}</button>
                               ))}
                            </div>
                          </div>
                          <div>
                            <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Style</label>
                            <select value={stylePreset} onChange={(e) => setStylePreset(e.target.value)} className="w-full text-xs p-1.5 rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700">
                               {STYLE_PRESETS.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                          </div>
                       </div>
                       
                       <div className="flex flex-col gap-2 bg-indigo-50 dark:bg-indigo-900/20 p-2 rounded border border-indigo-100 dark:border-indigo-800">
                          <div className="flex items-center gap-2">
                            <input type="checkbox" id="auto-audio" checked={isAutoAudio} onChange={(e) => setIsAutoAudio(e.target.checked)} className="rounded text-indigo-600 focus:ring-indigo-500" />
                            <label htmlFor="auto-audio" className="text-xs font-bold text-indigo-700 dark:text-indigo-300 cursor-pointer flex-1">
                               Auto-Sense Multi-Character Audio
                            </label>
                          </div>
                          {isAutoGenerating && (
                              <div className="flex items-center gap-2 pl-6 animate-fade-in">
                                 <label className="text-[10px] font-bold text-slate-500">Count:</label>
                                 <input 
                                   type="number" 
                                   min="1" 
                                   max="20" 
                                   value={autoGenCount} 
                                   onChange={(e) => setAutoGenCount(Math.max(1, Math.min(20, parseInt(e.target.value))))}
                                   className="w-16 text-xs p-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800"
                                 />
                                 <span className="text-[10px] text-slate-400">clips</span>
                              </div>
                          )}
                       </div>
                    </div>
                 )}
                 {activeTab === 'advanced' && (
                    <div className="animate-fade-in space-y-4">
                       <div className="pb-2 border-b border-slate-100 dark:border-slate-700 mb-2">
                          <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Generation Control</span>
                       </div>

                       <div>
                          <div className="flex justify-between text-xs mb-1">
                             <span className="text-slate-500 font-bold">Seed (Reproducibility)</span>
                             <span className="text-[10px] text-slate-400">Optional</span>
                          </div>
                          <div className="flex gap-2">
                            <input 
                              type="number" 
                              placeholder="Random" 
                              value={seed ?? ''} 
                              onChange={(e) => setSeed(e.target.value ? parseInt(e.target.value) : undefined)} 
                              className="w-full text-xs p-2 rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 focus:ring-2 focus:ring-blue-500 outline-none"
                            />
                            <button 
                              onClick={() => setSeed(Math.floor(Math.random() * 1000000))}
                              className="px-3 bg-slate-100 dark:bg-slate-600 text-slate-600 dark:text-slate-300 text-xs rounded hover:bg-slate-200 dark:hover:bg-slate-500 transition-colors border border-slate-200 dark:border-slate-500"
                              title="Generate Random Seed"
                            >
                              🎲
                            </button>
                            <button 
                              onClick={() => setSeed(undefined)}
                              className="px-3 bg-slate-100 dark:bg-slate-600 text-slate-600 dark:text-slate-300 text-xs rounded hover:bg-slate-200 dark:hover:bg-slate-500 transition-colors border border-slate-200 dark:border-slate-500"
                              title="Clear Seed"
                            >
                              ✕
                            </button>
                          </div>
                       </div>

                       <div className="h-px bg-slate-100 dark:bg-slate-700 my-2"></div>

                       <div>
                          <div className="flex justify-between text-xs mb-1">
                             <span className="text-slate-500 font-bold">Frame Rate</span>
                             <span className="bg-slate-100 dark:bg-slate-700 px-1.5 rounded text-[10px]">{frameRate} FPS</span>
                          </div>
                          <input type="range" min="24" max="60" step="1" value={frameRate} onChange={(e) => setFrameRate(parseInt(e.target.value))} className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer" />
                       </div>

                       <div>
                          <div className="flex justify-between text-xs mb-1">
                             <span className={`font-bold ${timeline.length > 0 ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500'}`}>
                                {timeline.length > 0 ? `Scene ${activeSceneIndex + 1} Duration` : "Default Scene Duration"}
                             </span>
                             <span className="bg-slate-100 dark:bg-slate-700 px-1.5 rounded text-[10px]">{sceneDuration}s</span>
                          </div>
                          <input 
                              type="range" 
                              min="1" 
                              max="15" 
                              step="1" 
                              value={timeline.length > 0 ? (timeline[activeSceneIndex]?.duration || 5) : sceneDuration} 
                              onChange={handleDurationChange} 
                              className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer" 
                          />
                          <div className="text-[10px] text-slate-400 mt-1">
                             {timeline.length > 0 ? "Adjusts duration of selected scene in timeline." : "Target duration for new scenes."}
                          </div>
                       </div>

                       <div>
                          <div className="flex justify-between text-xs mb-1">
                             <span className="text-slate-500 font-bold">Motion Intensity</span>
                             <span>{motionIntensity}/10</span>
                          </div>
                          <input type="range" min="1" max="10" value={motionIntensity} onChange={(e) => setMotionIntensity(parseInt(e.target.value))} className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer" />
                       </div>
                       
                       <div className="flex gap-2 items-center bg-slate-50 dark:bg-slate-700/50 p-2 rounded">
                          <input type="checkbox" id="char-lock" checked={characterLock} onChange={(e) => setCharacterLock(e.target.checked)} className="rounded text-blue-600 focus:ring-blue-500" />
                          <label htmlFor="char-lock" className="text-xs font-medium cursor-pointer flex-1">
                             Character Consistency Lock
                          </label>
                       </div>
                    </div>
                 )}
              </div>
           </div>

           {/* Audio Panel */}
           {timeline.length > 0 && (
             <div className="bg-white dark:bg-slate-800 p-5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm animate-fade-in">
                <div className="flex justify-between items-center mb-2">
                   <h4 className="font-bold text-sm text-slate-700 dark:text-slate-300">🎙️ Scene Audio</h4>
                   <span className="text-[10px] bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-200 px-2 py-0.5 rounded-full">For Scene {activeSceneIndex + 1}</span>
                </div>
                
                <textarea 
                  value={voiceText}
                  onChange={(e) => setVoiceText(e.target.value)}
                  placeholder="Enter script (e.g. 'Hero: Hello! Villain: No!') or use Auto-Sense..."
                  className="w-full h-16 p-2 text-xs border border-slate-200 dark:border-slate-600 rounded bg-slate-50 dark:bg-slate-900 resize-none mb-2"
                />
                
                <div className="flex gap-2">
                  <button 
                    onClick={() => handleGenerateVoiceover(true)}
                    disabled={isGeneratingAudio || coolDown > 0}
                    className="flex-1 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 text-white text-[10px] font-bold rounded hover:opacity-90 disabled:opacity-50"
                  >
                    {isGeneratingAudio ? 'Generating...' : '✨ Auto-Sense & Multi-Voice'}
                  </button>
                  <button 
                    onClick={() => handleGenerateVoiceover(false)}
                    disabled={isGeneratingAudio || !voiceText || coolDown > 0}
                    className="flex-1 py-2 bg-slate-700 text-white text-[10px] font-bold rounded hover:bg-slate-800 disabled:opacity-50"
                  >
                    🎤 Manual TTS
                  </button>
                </div>
             </div>
           )}

           <div className="flex flex-col gap-3">
              {isGenerating ? (
                 <button onClick={handleStopAuto} className="w-full py-4 bg-red-500 text-white rounded-xl font-bold animate-pulse">⏹ STOP GENERATION</button>
              ) : (
                 <button 
                    onClick={handleStartGeneration} 
                    disabled={isGenerating || coolDown > 0}
                    className={`w-full py-4 rounded-xl font-bold text-white transition-all flex items-center justify-center gap-2 ${
                        coolDown > 0 
                            ? 'bg-slate-400 cursor-not-allowed'
                            : isAutoGenerating 
                              ? 'bg-gradient-to-r from-purple-600 to-pink-600 hover:shadow-purple-500/30' 
                              : timeline.length > 0
                                ? 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:shadow-emerald-500/30'
                                : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:shadow-blue-500/30'
                    }`}
                 >
                    {coolDown > 0 
                        ? `⏳ Cooling Down (${coolDown}s)` 
                        : isAutoGenerating 
                          ? `🚀 Auto-Gen ${autoGenCount} Scenes` 
                          : (timeline.length > 0 ? '🎬 Generate Next Scene' : '✨ Generate Scene 1')
                    }
                 </button>
              )}
              {isAutoGenerating && <div className="text-center text-[10px] text-slate-400">Throttling active: 5s pause between clips to protect quota.</div>}
           </div>
           
           {error && (
             <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 p-4 rounded-lg text-sm font-medium animate-bounce-in">
               <div className="flex items-center gap-2 mb-1 text-lg">⚠️ Error</div>
               {isQuotaError ? (
                   <div>
                       <strong>Quota Exceeded (429)</strong>
                       <p className="text-xs mt-1 opacity-90">You hit the API limit. We've paused buttons for 60s to let your quota reset.</p>
                   </div>
               ) : (
                   isSafetyError ? "🛡️ Safety Block: Try a simpler prompt without people." : error
               )}
               {isApiKeyError && (
                 <div className="mt-3 p-2 bg-white/50 dark:bg-black/20 rounded">
                   <p className="text-xs mb-2 font-bold">Your API Key needs permission/billing.</p>
                   <button 
                     onClick={handleSelectKey} 
                     className="bg-red-600 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-red-700 shadow-sm"
                   >
                     🔑 Update API Key
                   </button>
                 </div>
               )}
             </div>
           )}

        </div>

        {/* RIGHT COLUMN */}
        <div className="lg:col-span-8 flex flex-col h-full space-y-6">
           
           {/* PLAYER */}
           <div className="flex-1 bg-black rounded-2xl overflow-hidden relative shadow-2xl border border-slate-800 group">
              <audio ref={audioPlayerRef} className="hidden" />
              <video 
                  ref={videoPlayerARef} 
                  className={getPlayerClasses('A')} 
                  controls={!isPlayingAll} 
                  onEnded={() => !isPlayingAll && handleSceneEnd()} 
              />
              <video 
                  ref={videoPlayerBRef} 
                  className={getPlayerClasses('B')} 
                  controls={!isPlayingAll} 
                  onEnded={() => !isPlayingAll && handleSceneEnd()} 
              />
              
              {/* DOWNLOAD OVERLAY BUTTON */}
              {!isPlayingAll && currentScene && (
                 <button 
                    onClick={handleDownloadActiveVideo}
                    className="absolute top-4 right-4 z-40 bg-black/50 hover:bg-black/80 text-white p-2 rounded-full backdrop-blur-sm border border-white/20 transition-all opacity-0 group-hover:opacity-100"
                    title="Download Scene"
                 >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                 </button>
              )}

              {!currentScene && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-600">
                   <div className="text-6xl mb-4 opacity-50">🎬</div>
                   <p className="font-medium">Ready to create</p>
                </div>
              )}
              
              {!isPlayingAll && currentScene && (
                 <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex justify-between items-center z-30 pointer-events-none">
                    <div className="flex flex-col gap-1 items-start">
                      <span className="text-white text-xs font-mono bg-black/50 px-2 py-1 rounded">
                         Scene {activeSceneIndex + 1} • {currentScene.duration}s
                      </span>
                      {currentScene.audioScript && (
                        <span className="text-white/80 text-[10px] bg-black/50 px-2 py-1 rounded italic max-w-md">"{currentScene.audioScript}"</span>
                      )}
                    </div>
                 </div>
              )}
           </div>

           {/* TIMELINE */}
           <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col">
              <div className="flex justify-between items-center mb-3">
                 <h3 className="font-bold text-slate-700 dark:text-slate-300 text-sm flex items-center gap-2">
                    🎞️ Story Timeline
                    {selectedSceneIds.size > 0 && <span className="text-blue-600 text-xs bg-blue-50 px-2 py-0.5 rounded-full">{selectedSceneIds.size} Selected</span>}
                 </h3>
                 <div className="flex gap-2">
                    <button onClick={clearTimeline} disabled={timeline.length === 0} className="text-xs text-red-500 hover:text-red-700 disabled:opacity-30 px-2 py-1">Clear</button>
                    <button 
                       onClick={handleDownloadProjectZip} 
                       disabled={timeline.length === 0 || isZipping} 
                       className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors disabled:opacity-50 shadow-md ${selectedSceneIds.size > 0 ? 'bg-purple-600 text-white hover:bg-purple-700' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}
                    >
                        {isZipping ? 'Zipping...' : (selectedSceneIds.size > 0 ? `⬇ Download (${selectedSceneIds.size})` : '⬇ Download All')}
                    </button>
                    <button onClick={() => setShowExportModal(true)} disabled={timeline.length === 0} className="flex items-center gap-1.5 bg-indigo-50 dark:bg-slate-700 text-indigo-700 dark:text-slate-200 px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-indigo-100 transition-colors disabled:opacity-50">🔗 Merge Guide</button>
                    <button onClick={handlePlayAll} disabled={timeline.length === 0} className="flex items-center gap-1.5 bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-3 py-1.5 rounded-lg text-xs font-bold hover:scale-105 transition-transform disabled:opacity-50 disabled:scale-100 shadow-md">▶ Play Movie</button>
                    <button onClick={handleSaveProject} disabled={timeline.length === 0} className="flex items-center gap-1.5 bg-blue-100 dark:bg-slate-700 text-blue-700 dark:text-slate-200 px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-blue-200 transition-colors disabled:opacity-50">💾 Save</button>
                 </div>
              </div>
              
              <div className="flex items-center gap-1 overflow-x-auto pb-2 scrollbar-hide snap-x">
                 {timeline.length === 0 ? (
                    <div className="w-full py-8 text-center border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-lg text-slate-400 text-xs">
                       Generated scenes will appear here.
                    </div>
                 ) : (
                    timeline.map((scene, idx) => (
                       <React.Fragment key={scene.id}>
                          {/* Scene Card */}
                          <div 
                            onClick={() => {
                              setIsPlayingAll(false);
                              setActiveSceneIndex(idx);
                              setActivePlayer('A');
                              setIsTransitioning(false);
                            }}
                            className={`relative flex-shrink-0 w-32 aspect-video bg-black rounded-lg overflow-hidden cursor-pointer border-2 transition-all snap-start group ${
                               activeSceneIndex === idx 
                                 ? 'border-blue-500 ring-2 ring-blue-500/20 scale-105 z-10' 
                                 : 'border-transparent opacity-70 hover:opacity-100'
                            } ${selectedSceneIds.has(scene.id) ? 'ring-2 ring-purple-500 ring-offset-2 dark:ring-offset-slate-800' : ''}`}
                          >
                             <video src={scene.url} className="w-full h-full object-cover pointer-events-none" />
                             
                             {/* BIG CHECKBOX FOR SELECTION */}
                             <div 
                               onClick={(e) => toggleSceneSelection(scene.id, e)}
                               className={`absolute top-1 left-1 z-30 w-6 h-6 rounded border flex items-center justify-center cursor-pointer transition-all shadow-md ${
                                 selectedSceneIds.has(scene.id) 
                                   ? 'bg-purple-600 border-purple-600 scale-110' 
                                   : 'bg-black/50 border-white/50 hover:bg-black/80'
                               }`}
                               title="Select to Download/Merge"
                             >
                                {selectedSceneIds.has(scene.id) && <span className="text-white text-xs font-bold">✓</span>}
                             </div>

                             {/* INDIVIDUAL SCENE DOWNLOAD BUTTON */}
                             <div 
                               onClick={(e) => handleDownloadScene(e, scene, idx)}
                               className="absolute top-1 right-8 z-30 w-6 h-6 rounded bg-black/50 hover:bg-blue-600 text-white flex items-center justify-center cursor-pointer transition-colors shadow-sm"
                               title="Download this scene"
                             >
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                             </div>

                             <div className="absolute bottom-1 right-1 bg-black/60 text-white text-[10px] px-1 rounded font-mono z-10">{idx + 1}</div>
                             
                             {/* DURATION BADGE */}
                             <div className="absolute bottom-1 left-1 bg-black/60 text-white text-[9px] px-1 rounded font-mono z-10">{scene.duration}s</div>

                             <div className="absolute top-1 right-1 flex gap-0.5 z-10">
                                {scene.audioUrl && <span className="text-[10px]">🎙️</span>}
                                {scene.mergedUrl && <span className="text-[10px]" title="Merged Audio/Video Ready">🔗</span>}
                             </div>
                          </div>

                          {idx < timeline.length - 1 && (
                            <div className="flex-shrink-0 flex flex-col items-center justify-center w-8 z-0 relative group/trans">
                               <div className="h-0.5 w-full bg-slate-200 dark:bg-slate-700 absolute top-1/2 -translate-y-1/2"></div>
                               <div className="relative z-10">
                                 <button onClick={() => toggleTransition(idx + 1)} className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] border shadow-sm transition-all hover:scale-110 bg-slate-100 border-slate-300 text-slate-500`}>
                                    {timeline[idx+1].transition === 'cut' ? '✂️' : timeline[idx+1].transition === 'fade' ? '🌫️' : '↔️'}
                                 </button>
                               </div>
                            </div>
                          )}
                       </React.Fragment>
                    ))
                 )}
                 {isGenerating && (
                    <div className="flex-shrink-0 w-32 aspect-video bg-slate-100 dark:bg-slate-700/50 rounded-lg border-2 border-dashed border-blue-400 flex flex-col items-center justify-center animate-pulse ml-2">
                       <span className="text-[10px] text-blue-500 font-bold">Generating...</span>
                    </div>
                 )}
              </div>
           </div>

        </div>
      </div>
      
      {showExportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
           <div className="bg-white dark:bg-slate-800 max-w-lg w-full rounded-2xl p-6 shadow-2xl border border-slate-200 dark:border-slate-700 animate-fade-in">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">Export Merged Video</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">Download your clips first, then use this script.</p>
              <div className="bg-slate-100 dark:bg-slate-900 p-3 rounded-lg overflow-x-auto mb-4 border border-slate-200 dark:border-slate-700">
                 <pre className="text-xs font-mono text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{generateFFmpegScript()}</pre>
              </div>
              <div className="flex justify-end gap-2">
                 <button onClick={() => navigator.clipboard.writeText(generateFFmpegScript())} className="px-4 py-2 bg-slate-200 dark:bg-slate-700 rounded-lg text-sm font-bold">Copy Script</button>
                 <button onClick={() => setShowExportModal(false)} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold">Done</button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};