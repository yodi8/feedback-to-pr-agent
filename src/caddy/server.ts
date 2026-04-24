import { spawn, ChildProcess } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";

let caddy: ChildProcess | null = null;
const previewRoot = path.resolve(config.caddy.previewDir);
const previewFile = path.join(previewRoot, "index.html");

export async function writePreview(content: string): Promise<void> {
  await mkdir(previewRoot, { recursive: true });
  await writeFile(previewFile, content, "utf-8");
}

export async function startCaddy(): Promise<string> {
  await mkdir(previewRoot, { recursive: true });
  if (caddy) return previewUrl();

  caddy = spawn(
    "caddy",
    ["file-server", "--root", previewRoot, "--listen", `:${config.caddy.port}`],
    { stdio: "inherit", shell: process.platform === "win32" },
  );

  caddy.on("exit", (code) => {
    console.error(`[caddy] exited with code ${code}`);
    caddy = null;
  });

  return previewUrl();
}

export function previewUrl(): string {
  return `http://localhost:${config.caddy.port}/`;
}

export function stopCaddy(): void {
  if (caddy) {
    caddy.kill();
    caddy = null;
  }
}
