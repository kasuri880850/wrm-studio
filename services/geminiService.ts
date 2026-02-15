import { GoogleGenAI, Type, HarmCategory, HarmBlockThreshold, Modality } from "@google/genai";
import { GEMINI_PRO_MODEL, VEO_MODEL, SYSTEM_INSTRUCTION_ANALYSIS, THINKING_BUDGET } from "../constants";
import { AnalysisResult } from "../types";

// Helper to ensure we have a fresh client (for API key updates)
const getAiClient = () => new GoogleGenAI({ apiKey: process.env.API_KEY });

// --- RETRY LOGIC ---
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function retryOperation<T>(operation: () => Promise<T>, retries = 3, delay = 10000): Promise<T> {
  try {
    return await operation();
  } catch (error: any) {
    // Inspect potential nested structures for specific error codes
    const errorStr = JSON.stringify(error);
    const isResourceExhausted = 
        error.message?.includes('RESOURCE_EXHAUSTED') || 
        error.status === 'RESOURCE_EXHAUSTED' ||
        error.status === 429 ||
        error.code === 429 ||
        errorStr.includes('RESOURCE_EXHAUSTED');

    const isAuthError = error.status === 403 || error.status === 401 || 
                        error.message?.includes('API key') || 
                        error.message?.includes('billing') ||
                        error.message?.includes('PERMISSION_DENIED');
    
    // CRITICAL: Fail fast on Auth or Quota (Resource Exhausted)
    // We handle Quota in UI with a visible countdown. Background retry is bad UX for long waits.
    if (isAuthError || isResourceExhausted) {
      // Ensure the message indicates the type for the UI to catch
      if (isResourceExhausted && !error.message?.includes('RESOURCE_EXHAUSTED')) {
         const originalMsg = error.message || "Quota exceeded";
         // Create a new error to preserve the stack but update the message
         const newError = new Error("RESOURCE_EXHAUSTED: " + originalMsg);
         (newError as any).originalError = error;
         throw newError;
      }
      throw error; 
    }

    // Check for Service Overload (503)
    const isOverload = error.message?.includes('503') || error.status === 503;

    if (retries > 0 && isOverload) {
      console.warn(`API Overload (503). Pausing for ${delay/1000}s... (${retries} retries left)`);
      await wait(delay);
      // Exponential backoff
      return retryOperation(operation, retries - 1, delay * 2); 
    }
    
    throw error;
  }
}

export const analyzeReviews = async (reviews: string): Promise<AnalysisResult> => {
  return retryOperation(async () => {
    const ai = getAiClient();
    const response = await ai.models.generateContent({
      model: GEMINI_PRO_MODEL,
      contents: `Analyze the following customer reviews:\n\n${reviews}`,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION_ANALYSIS,
        thinkingConfig: { thinkingBudget: THINKING_BUDGET },
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            trend: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  date: { type: Type.STRING },
                  sentiment: { type: Type.NUMBER }
                }
              }
            },
            keywords: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  text: { type: Type.STRING },
                  count: { type: Type.NUMBER },
                  sentiment: { type: Type.STRING, enum: ['positive', 'negative', 'neutral'] }
                }
              }
            },
            summary: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                points: { type: Type.ARRAY, items: { type: Type.STRING } },
                actionableAreas: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      area: { type: Type.STRING },
                      description: { type: Type.STRING }
                    }
                  }
                }
              }
            }
          },
          required: ["trend", "keywords", "summary"]
        }
      }
    });

    if (response.text) {
      return JSON.parse(response.text) as AnalysisResult;
    }
    throw new Error("No data returned from analysis.");
  });
};

export const chatWithGemini = async (
  history: { role: string; parts: { text: string }[] }[], 
  message: string,
  systemInstruction?: string,
  imageBase64?: string | null
) => {
  return retryOperation(async () => {
    const ai = getAiClient();
    const chat = ai.chats.create({
      model: GEMINI_PRO_MODEL,
      history: history,
      config: { systemInstruction }
    });

    // Construct message payload
    let messagePayload: any = message;

    if (imageBase64) {
      // If we have an image, we must construct a multipart message
      // Extract mime type and data
      const mimeMatch = imageBase64.match(/^data:(image\/[a-zA-Z+]+);base64,/);
      const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
      const cleanBase64 = imageBase64.replace(/^data:image\/[a-zA-Z+]+;base64,/, "");

      messagePayload = [
        { text: message },
        { 
          inlineData: {
            mimeType: mimeType,
            data: cleanBase64
          }
        }
      ];
    }

    const result = await chat.sendMessage({ message: messagePayload });
    return result.text;
  });
};

// --- AUDIO UTILS ---

const addWavHeader = (samples: Uint8Array, sampleRate: number = 24000, numChannels: number = 1) => {
  const buffer = new ArrayBuffer(44 + samples.length);
  const view = new DataView(buffer);
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, samples.length, true);
  const dest = new Uint8Array(buffer, 44);
  dest.set(samples);
  return buffer;
};

const writeString = (view: DataView, offset: number, string: string) => {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
};

export const generateCreativeScript = async (sceneDescription: string, style: string = 'Cinematic'): Promise<string> => {
  return retryOperation(async () => {
    const ai = getAiClient();
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash", 
      contents: `
        You are a cinematic Audio Director.
        
        TASK:
        Based on the visual scene description below, write a short audio script (1-2 sentences).
        
        AUTO-SENSE LOGIC:
        - If the scene implies dialogue between characters, write the dialogue with Speaker labels (e.g., "Hero: Stop right there!", "Villain: Never!").
        - If it's a single character or landscape, write a narration without labels.
        
        SCENE: "${sceneDescription}"
        STYLE: "${style}"

        OUTPUT FORMAT:
        Just the text. If multiple speakers, use "Name: " format.
      `,
    });
    return response.text?.trim() || "The scene unfolds naturally.";
  });
};

export const generateSpeech = async (text: string, voiceName: string = 'Kore'): Promise<string> => {
  return retryOperation(async () => {
    const ai = getAiClient();
    
    // Check for multi-speaker format (e.g., "Name: ...")
    // Simple regex to detect if lines start with Name:
    const lines = text.split('\n').map(l => l.trim()).filter(l => l);
    const speakers = new Set<string>();
    const isMultiSpeaker = lines.length > 1 && lines.every(l => /^[A-Za-z0-9 ]+:/.test(l));

    let speechConfig: any = {
      voiceConfig: {
        prebuiltVoiceConfig: { voiceName },
      },
    };

    if (isMultiSpeaker) {
       lines.forEach(l => {
         const name = l.split(':')[0].trim();
         speakers.add(name);
       });
       
       const speakerList = Array.from(speakers);
       const availableVoices = ['Kore', 'Puck', 'Fenrir', 'Charon', 'Zephyr'];
       
       const speakerVoiceConfigs = speakerList.map((speaker, index) => ({
         speaker: speaker,
         voiceConfig: {
           prebuiltVoiceConfig: { 
             voiceName: availableVoices[index % availableVoices.length] // Rotate through voices
           }
         }
       }));

       speechConfig = {
         multiSpeakerVoiceConfig: {
           speakerVoiceConfigs
         }
       };
    }

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) throw new Error("No audio generated");
    
    const binaryString = atob(base64Audio);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const wavBuffer = addWavHeader(bytes, 24000, 1);
    const blob = new Blob([wavBuffer], { type: 'audio/wav' });
    
    return URL.createObjectURL(blob);
  });
};

export interface VeoGenerationResult {
  url: string;
  asset: any; 
}

export const generateVeoVideo = async (
  prompt: string, 
  imageBase64: string | null, 
  aspectRatio: '16:9' | '9:16' = '16:9',
  resolution: '720p' | '1080p' = '720p',
  frameRate: number = 24,
  stylePreset?: string,
  characterLock: boolean = true,
  previousVideo?: any,
  seed?: number
): Promise<VeoGenerationResult> => {
  return retryOperation(async () => {
    const ai = getAiClient();
    const defaultPrompt = imageBase64 
      ? "Animate this character naturally, maintaining exact consistency with the original image." 
      : "Animate this character naturally";

    let finalPrompt = (prompt && prompt.trim()) ? prompt : defaultPrompt;

    if (previousVideo) {
      if (!finalPrompt.toLowerCase().includes("continue")) {
          finalPrompt = `Continue exactly from the last frame. ${finalPrompt}`;
      }
    } else if (imageBase64 && characterLock) {
      finalPrompt += `. CRITICAL: Maintain exact physical appearance, face, and clothing of the character from the reference image. The character identity must not change.`;
    }
    
    if (stylePreset && stylePreset !== 'None') {
      finalPrompt += ` The video should be rendered in a ${stylePreset} style.`;
    }

    let fpsString = '24fps';
    if (frameRate >= 50) fpsString = '60fps';
    else if (frameRate >= 28) fpsString = '30fps';
    else fpsString = '24fps';
    
    const videoConfig: any = {
      numberOfVideos: 1,
      resolution: previousVideo ? '720p' : resolution,
      aspectRatio: aspectRatio,
      frameRate: fpsString,
      safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH }
      ]
    };

    if (seed !== undefined) {
      videoConfig.seed = seed;
    }

    const requestPayload: any = {
      model: VEO_MODEL,
      prompt: finalPrompt,
      config: videoConfig
    };

    if (previousVideo) {
      requestPayload.video = previousVideo;
    } else if (imageBase64) {
      const mimeMatch = imageBase64.match(/^data:(image\/[a-zA-Z+]+);base64,/);
      const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
      const cleanBase64 = imageBase64.replace(/^data:image\/[a-zA-Z+]+;base64,/, "");
      requestPayload.image = { imageBytes: cleanBase64, mimeType: mimeType };
    }

    let operation;
    try {
      operation = await ai.models.generateVideos(requestPayload);
    } catch (e: any) {
      console.error("Veo Launch Error:", e);
      if (e.message?.includes('400')) {
        throw new Error("Invalid Request: Image format unsupported or safety violation.");
      }
      throw e;
    }

    let retries = 0;
    while (!operation.done) {
      await wait(5000);
      try {
        operation = await ai.operations.getVideosOperation({ operation: operation });
        retries++;
        if (retries > 120) throw new Error("Generation timed out.");
      } catch (pollError) {
        console.error("Polling Error:", pollError);
        throw new Error("Failed to check video status. Network or API issue.");
      }
    }

    if (operation.error) {
      throw new Error(`Generation Failed: ${operation.error.message}`);
    }

    const generatedVideo = operation.response?.generatedVideos?.[0];
    const videoUri = generatedVideo?.video?.uri;
    const videoAsset = generatedVideo?.video;
    
    if (!videoUri) {
       // SPECIFIC ERROR MESSAGE FOR UI HANDLING
       throw new Error("Video generation failed or returned no URI");
    }

    const videoResponse = await fetch(`${videoUri}&key=${process.env.API_KEY}`);
    if (!videoResponse.ok) throw new Error("Failed to download generated video bytes.");
    const videoBlob = await videoResponse.blob();
    
    return {
      url: URL.createObjectURL(videoBlob),
      asset: videoAsset
    };
  }, 3, 15000); // Specific VEO call gets 3 retries starting at 15s wait
};