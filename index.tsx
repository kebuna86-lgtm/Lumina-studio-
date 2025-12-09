import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { GoogleGenAI, Type } from "@google/genai";
import { Scene, Script, TimelineClip, Track, Tab, VeoGenerationState } from "./types";
import { 
  Clapperboard, 
  Image as ImageIcon, 
  Film, 
  Play, 
  Save, 
  Wand2, 
  LayoutTemplate, 
  Video,
  Loader2,
  AlertCircle
} from "lucide-react";

// --- Utilities ---
const generateId = () => Math.random().toString(36).substr(2, 9);

// --- API Helper ---
const getAI = () => new GoogleGenAI({ apiKey: process.env.API_KEY });

const INITIAL_SCRIPT = `INT. SPACESHIP COCKPIT - NIGHT

The cockpit is bathed in urgent red emergency lighting. Sparks shower from the ceiling.

COMMANDER ZARA (30s, intense) grips the control stick, knuckles white. The void of space swirls outside the viewport.

ZARA
Hold on! We're making the jump!

EXT. SPACE - CONTINUOUS

The sleek silver vessel elongates, turning into a streak of starlight before vanishing into hyperspace.`;

const App = () => {
  // --- State ---
  const [activeTab, setActiveTab] = useState<Tab>('script');
  const [script, setScript] = useState<Script>({
    title: "Untitled Project",
    rawContent: INITIAL_SCRIPT,
    scenes: []
  });
  const [tracks, setTracks] = useState<Track[]>([
    { id: 1, name: "Video 1", type: "video", clips: [] },
    { id: 2, name: "Video 2", type: "video", clips: [] },
    { id: 3, name: "Audio 1", type: "audio", clips: [] },
  ]);
  const [isParsing, setIsParsing] = useState(false);
  const [generatingImages, setGeneratingImages] = useState<Record<string, boolean>>({});
  const [veoState, setVeoState] = useState<Record<string, VeoGenerationState>>({});
  const [hasPaidKey, setHasPaidKey] = useState(false);

  // Check for paid key on mount (needed for Veo)
  useEffect(() => {
    const checkKey = async () => {
      if (window.aistudio && window.aistudio.hasSelectedApiKey) {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        setHasPaidKey(hasKey);
      }
    };
    checkKey();
  }, []);

  const handleSelectKey = async () => {
    if (window.aistudio && window.aistudio.openSelectKey) {
      await window.aistudio.openSelectKey();
      const hasKey = await window.aistudio.hasSelectedApiKey();
      setHasPaidKey(hasKey);
    }
  };

  // --- Actions ---

  const parseScript = async () => {
    if (!script.rawContent.trim()) return;
    setIsParsing(true);
    
    try {
      const ai = getAI();
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: `Parse this movie script into a JSON list of scenes. For each scene, extract the slugline, a detailed visual description suitable for an image generator (no dialogue, just visuals), and an estimated duration in seconds. \n\nSCRIPT:\n${script.rawContent}`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                scene_number: { type: Type.INTEGER },
                slugline: { type: Type.STRING },
                visual_description: { type: Type.STRING },
                estimated_duration: { type: Type.NUMBER },
              },
              required: ["scene_number", "slugline", "visual_description", "estimated_duration"]
            }
          }
        }
      });

      const parsed = JSON.parse(response.text || "[]");
      const newScenes: Scene[] = parsed.map((s: any) => ({
        id: generateId(),
        number: s.scene_number,
        slugline: s.slugline,
        description: s.visual_description,
        duration: s.estimated_duration,
      }));

      setScript(prev => ({ ...prev, scenes: newScenes }));
      setActiveTab('storyboard');
    } catch (e) {
      console.error("Failed to parse script", e);
      alert("Failed to parse script. See console.");
    } finally {
      setIsParsing(false);
    }
  };

  const updateSceneDuration = (sceneId: string, newDuration: number) => {
    // Update Script
    setScript(prev => ({
      ...prev,
      scenes: prev.scenes.map(s => s.id === sceneId ? { ...s, duration: newDuration } : s)
    }));

    // Update Timeline Clips that are linked to this scene
    setTracks(prev => prev.map(track => ({
      ...track,
      clips: track.clips.map(clip => {
        if (clip.sceneId === sceneId) {
          return { ...clip, duration: newDuration };
        }
        return clip;
      })
    })));
  };

  const generateStoryboardImage = async (sceneId: string, description: string) => {
    setGeneratingImages(prev => ({ ...prev, [sceneId]: true }));
    try {
      const ai = getAI();
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-image",
        contents: `Cinematic movie storyboard, wide angle, high quality, 4k. ${description}`,
      });

      let imageUrl = "";
      // Handle the response to find the image part
      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          imageUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
          break;
        }
      }

      if (imageUrl) {
        setScript(prev => ({
          ...prev,
          scenes: prev.scenes.map(s => s.id === sceneId ? { ...s, storyboardUrl: imageUrl } : s)
        }));
      }
    } catch (e) {
      console.error("Image gen failed", e);
    } finally {
      setGeneratingImages(prev => ({ ...prev, [sceneId]: false }));
    }
  };

  const generateVeoVideo = async (scene: Scene) => {
    if (!hasPaidKey) {
      await handleSelectKey();
      if (!await window.aistudio.hasSelectedApiKey()) return;
    }

    if (!scene.storyboardUrl) {
      alert("Please generate a storyboard image first to use as a reference.");
      return;
    }

    setVeoState(prev => ({ ...prev, [scene.id]: { isGenerating: true, progressMessage: "Initializing Veo..." } }));

    try {
      // Create new AI instance to ensure key is picked up
      const ai = getAI();
      
      // Extract base64 from data URL
      const base64Data = scene.storyboardUrl.split(',')[1];
      const mimeType = scene.storyboardUrl.split(';')[0].split(':')[1];

      let operation = await ai.models.generateVideos({
        model: 'veo-3.1-fast-generate-preview',
        prompt: `Cinematic shot, photorealistic, 4k. ${scene.description}`,
        image: {
          imageBytes: base64Data,
          mimeType: mimeType,
        },
        config: {
          numberOfVideos: 1,
          resolution: '720p',
          aspectRatio: '16:9'
        }
      });

      setVeoState(prev => ({ ...prev, [scene.id]: { isGenerating: true, progressMessage: "Generating video..." } }));

      // Poll for completion
      while (!operation.done) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        operation = await ai.operations.getVideosOperation({ operation });
      }

      const videoUri = operation.response?.generatedVideos?.[0]?.video?.uri;
      if (videoUri) {
        // Fetch the actual video bytes using the API key
        const videoRes = await fetch(`${videoUri}&key=${process.env.API_KEY}`);
        const videoBlob = await videoRes.blob();
        const videoUrl = URL.createObjectURL(videoBlob);

        setScript(prev => ({
          ...prev,
          scenes: prev.scenes.map(s => s.id === scene.id ? { ...s, videoUrl } : s)
        }));
      }
    } catch (e) {
      console.error("Veo generation failed", e);
      alert("Video generation failed. Ensure you are using a paid billing project.");
    } finally {
      setVeoState(prev => ({ ...prev, [scene.id]: { isGenerating: false, progressMessage: "" } }));
    }
  };

  const addToTimeline = (scene: Scene) => {
    const newClip: TimelineClip = {
      id: generateId(),
      trackId: 1, // Default to first video track
      startTime: 0, // Simplified: always adds to start or append could be calculated
      duration: scene.duration,
      name: `Scene ${scene.number}`,
      type: 'video',
      color: '#06b6d4', // cyan
      sceneId: scene.id
    };

    // Find end time of last clip on track 1
    const track1 = tracks.find(t => t.id === 1);
    let startTime = 0;
    if (track1 && track1.clips.length > 0) {
      const lastClip = track1.clips[track1.clips.length - 1];
      startTime = lastClip.startTime + lastClip.duration;
    }
    newClip.startTime = startTime;

    setTracks(prev => prev.map(t => {
      if (t.id === 1) {
        return { ...t, clips: [...t.clips, newClip] };
      }
      return t;
    }));
    setActiveTab('timeline');
  };

  // --- Components ---

  const Navigation = () => (
    <nav className="w-64 bg-lumina-800 border-r border-lumina-700 flex flex-col h-screen fixed left-0 top-0 z-20">
      <div className="p-6">
        <h1 className="text-2xl font-bold bg-gradient-to-r from-lumina-cyan to-lumina-accent bg-clip-text text-transparent">
          Lumina Studio
        </h1>
        <p className="text-xs text-slate-400 mt-1">Cinematic Production Suite</p>
      </div>
      
      <div className="flex-1 px-4 space-y-2">
        {[
          { id: 'script', icon: Clapperboard, label: 'Scriptwriter' },
          { id: 'storyboard', icon: ImageIcon, label: 'Storyboard AI' },
          { id: 'timeline', icon: Film, label: 'Timeline Editor' },
        ].map(item => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id as Tab)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
              activeTab === item.id 
                ? 'bg-lumina-cyan/10 text-lumina-accent' 
                : 'text-slate-400 hover:bg-lumina-800 hover:text-white'
            }`}
          >
            <item.icon size={20} />
            <span className="font-medium">{item.label}</span>
          </button>
        ))}
      </div>

      <div className="p-4 border-t border-lumina-700">
        {!hasPaidKey && (
          <button 
            onClick={handleSelectKey}
            className="w-full text-xs flex items-center justify-center gap-2 bg-yellow-500/10 text-yellow-500 p-3 rounded-lg border border-yellow-500/20 hover:bg-yellow-500/20 transition-colors"
          >
            <AlertCircle size={14} />
            Connect Billing for Video
          </button>
        )}
      </div>
    </nav>
  );

  const ScriptEditor = () => (
    <div className="h-full flex flex-col max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-semibold">Script Editor</h2>
          <p className="text-slate-400 text-sm">Write your masterpiece. AI will parse scenes automatically.</p>
        </div>
        <button 
          onClick={parseScript}
          disabled={isParsing}
          className="flex items-center gap-2 bg-lumina-cyan hover:bg-lumina-accent text-lumina-900 px-6 py-2.5 rounded-lg font-semibold transition-all shadow-[0_0_15px_rgba(6,182,212,0.3)] disabled:opacity-50"
        >
          {isParsing ? <Loader2 className="animate-spin" size={20} /> : <Wand2 size={20} />}
          {isParsing ? "Analyzing..." : "Analyze & Create Scenes"}
        </button>
      </div>
      
      <textarea
        value={script.rawContent}
        onChange={(e) => setScript(prev => ({ ...prev, rawContent: e.target.value }))}
        className="flex-1 w-full bg-lumina-800 border border-lumina-700 rounded-xl p-8 font-mono text-lg leading-relaxed focus:outline-none focus:ring-2 focus:ring-lumina-cyan/50 resize-none shadow-inner"
        placeholder="INT. SCENE - DAY..."
      />
    </div>
  );

  const StoryboardView = () => (
    <div className="h-full flex flex-col">
      <header className="mb-6 flex justify-between items-end">
         <div>
          <h2 className="text-2xl font-semibold">Storyboard Generation</h2>
          <p className="text-slate-400 text-sm">
            {script.scenes.length} scenes detected. Generate visuals and video previews.
          </p>
        </div>
      </header>

      {script.scenes.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-slate-500 border-2 border-dashed border-lumina-700 rounded-2xl bg-lumina-800/30">
          <LayoutTemplate size={48} className="mb-4 opacity-50" />
          <p>No scenes parsed yet.</p>
          <button onClick={() => setActiveTab('script')} className="text-lumina-accent hover:underline mt-2">
            Go to Script Editor
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6 pb-20">
          {script.scenes.map((scene) => (
            <div key={scene.id} className="bg-lumina-800 border border-lumina-700 rounded-xl overflow-hidden group hover:border-lumina-cyan/30 transition-all">
              {/* Visual Display */}
              <div className="aspect-video bg-black relative">
                {scene.videoUrl ? (
                   <video src={scene.videoUrl} controls className="w-full h-full object-cover" />
                ) : scene.storyboardUrl ? (
                  <img src={scene.storyboardUrl} alt={scene.slugline} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-lumina-900/50">
                    <span className="text-slate-600">No visual generated</span>
                  </div>
                )}
                
                {/* Generation Status Overlay */}
                {(generatingImages[scene.id] || veoState[scene.id]?.isGenerating) && (
                  <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center gap-2 backdrop-blur-sm">
                    <Loader2 className="animate-spin text-lumina-accent" size={32} />
                    <span className="text-sm font-medium text-lumina-accent">
                      {veoState[scene.id]?.isGenerating ? veoState[scene.id].progressMessage : "Rendering Image..."}
                    </span>
                  </div>
                )}
              </div>

              {/* Controls & Info */}
              <div className="p-4 space-y-4">
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-xs font-bold text-lumina-cyan uppercase tracking-wider">Scene {scene.number}</span>
                    <div className="flex items-center gap-2 bg-lumina-900 rounded px-2 py-1 border border-lumina-700/50">
                      <span className="text-[10px] text-slate-400">Duration</span>
                      <input 
                        type="number" 
                        min="0.1"
                        step="0.5"
                        value={scene.duration} 
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          if (!isNaN(val) && val >= 0) {
                            updateSceneDuration(scene.id, val);
                          }
                        }}
                        className="w-12 bg-transparent text-right text-xs font-medium focus:outline-none text-white appearance-none m-0 hover:bg-lumina-800 rounded transition-colors"
                      />
                      <span className="text-xs text-slate-500">s</span>
                    </div>
                  </div>
                  <h3 className="font-bold text-white truncate">{scene.slugline}</h3>
                  <p className="text-sm text-slate-400 mt-2 line-clamp-2" title={scene.description}>
                    {scene.description}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => generateStoryboardImage(scene.id, scene.description)}
                    disabled={generatingImages[scene.id]}
                    className="flex items-center justify-center gap-2 bg-lumina-700 hover:bg-lumina-600 py-2 rounded-lg text-xs font-medium transition-colors"
                  >
                    <ImageIcon size={14} />
                    {scene.storyboardUrl ? "Regenerate Image" : "Generate Image"}
                  </button>

                  <button
                    onClick={() => generateVeoVideo(scene)}
                    disabled={veoState[scene.id]?.isGenerating}
                    className="flex items-center justify-center gap-2 bg-lumina-700 hover:bg-lumina-600 py-2 rounded-lg text-xs font-medium transition-colors"
                  >
                    <Video size={14} />
                    {scene.videoUrl ? "Regenerate Video" : "Veo Video"}
                  </button>

                  <button
                    onClick={() => addToTimeline(scene)}
                    className="col-span-2 flex items-center justify-center gap-2 bg-lumina-cyan/10 text-lumina-accent hover:bg-lumina-cyan/20 border border-lumina-cyan/20 py-2 rounded-lg text-xs font-medium transition-colors"
                  >
                    <Play size={14} />
                    Add to Timeline
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const TimelineView = () => {
    // Basic timeline calculation
    const pixelsPerSecond = 20;
    
    return (
      <div className="h-full flex flex-col overflow-hidden">
        <div className="flex-1 bg-lumina-900 overflow-y-auto overflow-x-hidden relative">
          
          {/* Time Ruler (simplified) */}
          <div className="h-8 bg-lumina-800 border-b border-lumina-700 sticky top-0 z-10 flex">
            {Array.from({ length: 20 }).map((_, i) => (
              <div key={i} className="flex-shrink-0 border-l border-lumina-700 text-[10px] text-slate-500 pl-1 h-full" style={{ width: `${pixelsPerSecond * 10}px` }}>
                {i * 10}s
              </div>
            ))}
          </div>

          {/* Tracks */}
          <div className="min-h-[500px] p-4 space-y-4">
            {tracks.map(track => (
              <div key={track.id} className="flex gap-4">
                {/* Track Header */}
                <div className="w-32 flex-shrink-0 flex flex-col justify-center bg-lumina-800 rounded-lg p-3 border border-lumina-700">
                  <span className="text-sm font-medium text-slate-300">{track.name}</span>
                  <div className="flex gap-2 mt-2">
                     <div className={`w-2 h-2 rounded-full ${track.type === 'video' ? 'bg-lumina-cyan' : 'bg-purple-500'}`} />
                     <span className="text-[10px] uppercase text-slate-500">{track.type}</span>
                  </div>
                </div>

                {/* Track Lane */}
                <div className="flex-1 bg-lumina-800/30 rounded-lg relative h-24 border border-lumina-800/50 overflow-hidden">
                  {track.clips.map(clip => (
                    <div
                      key={clip.id}
                      className="absolute top-2 bottom-2 rounded-md px-3 py-1 text-xs font-medium text-white truncate border border-white/10 shadow-lg cursor-pointer hover:brightness-110 transition-all group"
                      style={{
                        left: `${clip.startTime * pixelsPerSecond}px`,
                        width: `${clip.duration * pixelsPerSecond}px`,
                        backgroundColor: clip.color
                      }}
                      title={`${clip.name} (${clip.duration}s)`}
                    >
                      <div className="flex items-center gap-2 h-full">
                        {clip.type === 'video' && <Film size={12} className="opacity-50" />}
                        {clip.name}
                        {/* Thumbnail if available */}
                        {clip.sceneId && script.scenes.find(s => s.id === clip.sceneId)?.storyboardUrl && (
                           <div className="ml-auto h-full aspect-video rounded overflow-hidden bg-black/20">
                              <img src={script.scenes.find(s => s.id === clip.sceneId)?.storyboardUrl} className="w-full h-full object-cover opacity-50 group-hover:opacity-100" />
                           </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex min-h-screen bg-lumina-900 text-white font-sans selection:bg-lumina-accent/30 selection:text-white">
      <Navigation />
      
      <main className="ml-64 flex-1 p-8 h-screen overflow-hidden">
        {activeTab === 'script' && <ScriptEditor />}
        {activeTab === 'storyboard' && <StoryboardView />}
        {activeTab === 'timeline' && <TimelineView />}
      </main>
    </div>
  );
};

const root = createRoot(document.getElementById("root")!);
root.render(<App />);