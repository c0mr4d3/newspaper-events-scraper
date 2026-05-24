import { spawn } from "node:child_process";
import process from "node:process";

const passThroughArgs = process.argv.slice(2);

await run("src/ocr.js", passThroughArgs);
await run("src/extractEvents.js", passThroughArgs);

function run(script, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      stdio: "inherit"
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${script} exited with code ${code}`));
    });
  });
}
