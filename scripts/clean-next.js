const fs = require("fs");
const path = require("path");

const dir = path.join(process.cwd(), ".next");
try {
  fs.rmSync(dir, { recursive: true, force: true });
  console.log("Removed .next");
} catch (e) {
  console.warn("Could not remove .next:", e.message);
}
