import OpenAI from "openai";
import { ensureChangeToPrefix } from "@/lib/refine/ensureChangeToPrefix";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const SYSTEM = {
  material:
    "You are a prompt engineer for ComfyUI img2img / material restyle (CLIP Text Encode positive prompt). " +
    "Translate Korean or natural language to English. " +
    "The output MUST start with exactly \"change to \" (lowercase, with a space after \"to\"), then a short phrase or comma-separated tags. " +
    "Example: change to 3d graphic, wood texture, soft lighting. " +
    "Describe material, surface, lighting, style of an existing cover graphic. Under 35 words. No quotes.",
  texture:
    "You are a prompt engineer for ComfyUI texture application onto an existing magazine cover image. " +
    "Translate Korean or natural language to English. " +
    "The output MUST start with exactly \"change to \" (lowercase, with a space after \"to\"), then comma-separated material/texture tags. " +
    "Example: change to wood grain, natural oak surface, warm brown tones, matte finish. " +
    "Describe surface material and texture to apply — grain, finish, color. Not object shape, not scene description. Under 35 words. No quotes."
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { prompt, purpose = "texture" } = req.body || {};
  if (!prompt) return res.status(400).json({ error: "prompt is required" });

  const systemContent = SYSTEM[purpose] || SYSTEM.material;

  try {
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: systemContent },
        { role: "user", content: String(prompt) }
      ],
      temperature: 0.7
    });

    let refinedPrompt = response.choices[0]?.message?.content?.trim();
    if (purpose === "material" || purpose === "texture" || !SYSTEM[purpose]) {
      refinedPrompt = ensureChangeToPrefix(refinedPrompt);
    }
    return res.status(200).json({ refinedPrompt, purpose });
  } catch (error) {
    console.error("OpenAI Error:", error);
    return res.status(500).json({ error: "Failed to refine prompt" });
  }
}
