import fs from "fs";
import path from "path";

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

function walkImages(absDir, out = []) {
  if (!fs.existsSync(absDir)) return out;
  for (const name of fs.readdirSync(absDir)) {
    const abs = path.join(absDir, name);
    let st;
    try {
      st = fs.statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walkImages(abs, out);
      continue;
    }
    const ext = path.extname(name).toLowerCase();
    if (!IMAGE_EXT.has(ext)) continue;
    const rel = path.relative(path.join(process.cwd(), "public"), abs).split(path.sep).join("/");
    out.push(`/${rel}`);
  }
  return out;
}

export default function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const root = path.join(process.cwd(), "public", "img", "original");
  const images = walkImages(root).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  res.setHeader("cache-control", "public, max-age=60");
  return res.status(200).json({ count: images.length, images });
}
