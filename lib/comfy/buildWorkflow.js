import fs from "fs";
import path from "path";
import { NODE_MAP } from "./pipeline";

const WORKFLOW_FILE = process.env.COMFY_WORKFLOW_FILE || "workflows/cover-pipeline.json";

/**
 * workflow JSON 이 있으면 mode / prompt / image 를 노드 inputs 에 주입.
 * 파일이 없거나 invalid 이면 null (prompt-only input 만 사용).
 */
export async function buildWorkflowPayload({ mode, prompt, texturePrompt, imageBase64 }) {
  const abs = path.join(process.cwd(), WORKFLOW_FILE);
  if (!fs.existsSync(abs)) return null;

  let template;
  try {
    template = JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch {
    return null;
  }

  const wf = JSON.parse(JSON.stringify(template));
  const coverId = NODE_MAP.loadImageCover;
  const clipId = NODE_MAP.clipPositiveMaterial;
  const texId = NODE_MAP.textMultilineTexture;

  if (wf[coverId]?.inputs && imageBase64) {
    wf[coverId].inputs.image = imageBase64;
  }
  if (wf[clipId]?.inputs && prompt) {
    wf[clipId].inputs.text = prompt;
  }
  if (mode === "texture_map" && wf[texId]?.inputs) {
    wf[texId].inputs.text = texturePrompt || prompt;
  }
  if (mode === "texture" && wf[texId]?.inputs) {
    wf[texId].inputs.text = texturePrompt || prompt;
  }

  wf._meta = { mode, patchedAt: new Date().toISOString() };
  return wf;
}
