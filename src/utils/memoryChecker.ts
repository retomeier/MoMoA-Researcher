import * as os from 'os';

export function checkContainerMemory(): string {
  // Helper to convert bytes to Megabytes
  const toMB = (bytes: number) => Math.round((bytes / 1024 / 1024) * 100) / 100;

  // Container/System level memory (What Cloud Run gives you)
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  // Process level memory (What your Node server is currently eating)
  const procMem = process.memoryUsage();

  let memory = `Total Container  Memory    : ${toMB(totalMem)} MB\n\n`;
  memory +=    `Container Available Memory : ${toMB(freeMem)} MB`;
  return memory;
}