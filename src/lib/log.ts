import { appendFileSync } from 'node:fs';

const LOG_FILE = 'run.log';

function write(level: string, msg: string) {
  const line = `${new Date().toISOString()} [${level}] ${msg}`;
  console.log(line);
  appendFileSync(LOG_FILE, line + '\n');
}

export const log = {
  info: (msg: string) => write('INFO', msg),
  warn: (msg: string) => write('WARN', msg),
  error: (msg: string) => write('ERROR', msg),
};
