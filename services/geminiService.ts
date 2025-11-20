
import { GoogleGenAI, Modality } from "@google/genai";
import { Suggestion } from "../types";

const apiKey = process.env.API_KEY;
const ai = new GoogleGenAI({ apiKey: apiKey });

/**
 * Generates a single edited version of the image based on the selected style.
 * Uses gemini-2.5-flash-image for image-to-image editing.
 */
export const generateEditedImage = async (
  base64Data: string,
  mimeType: string,
  style: Suggestion
): Promise<string> => {
  try {
    const modelId = "gemini-2.5-flash-image";
    
    // Specific logic for "Clean Studio Backdrop" to ensure subject preservation
    let systemInstruction = "You are an expert photo retoucher.";
    let prompt = `Edit this image to apply the following style: "${style.title}". 
    Detailed instructions: ${style.description}.
    Ensure the output is a high-quality photograph.`;

    if (style.title === "Clean Studio Backdrop") {
        prompt += `\nCRITICAL: The main subject (person/object) must remain EXACTLY the same in terms of pose, position, clothing, and expression. Do NOT regenerate or alter the subject.
        Only modify the background environment.
        The new background must match the ORIGINAL lighting intensity, direction, and color temperature exactly. It should just be cleaner and less distracting.`;
    }

    const response = await ai.models.generateContent({
      model: modelId,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: mimeType,
              data: base64Data,
            },
          },
          { text: prompt },
        ],
      },
      config: {
        responseModalities: [Modality.IMAGE],
        systemInstruction: systemInstruction,
      },
    });

    const part = response.candidates?.[0]?.content?.parts?.[0];
    if (part && part.inlineData && part.inlineData.data) {
      return part.inlineData.data;
    }
    
    throw new Error("No image generated.");
  } catch (error) {
    console.error("Error generating edit:", error);
    throw error;
  }
};

/**
 * Replaces an object in the image based on a user-drawn mask.
 */
export const replaceObject = async (
  originalBase64: string,
  maskBase64: string,
  promptText: string
): Promise<string> => {
  try {
    const modelId = "gemini-2.5-flash-image";
    
    const prompt = `Use the provided black and white mask image to identify the area to edit in the original image. 
    Replace the masked area (white area in the mask) with: "${promptText}".
    Blend the new object seamlessly into the original environment, matching lighting, shadows, and perspective.`;

    const response = await ai.models.generateContent({
      model: modelId,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: "image/png",
              data: originalBase64,
            },
          },
          {
            inlineData: {
              mimeType: "image/png",
              data: maskBase64,
            },
          },
          { text: prompt },
        ],
      },
      config: {
        responseModalities: [Modality.IMAGE],
      },
    });

    const part = response.candidates?.[0]?.content?.parts?.[0];
    if (part && part.inlineData && part.inlineData.data) {
      return part.inlineData.data;
    }
    
    throw new Error("No image generated.");
  } catch (error) {
    console.error("Error replacing object:", error);
    throw error;
  }
};
