/**
 * The two routes onto the VM, and the port discovery the tunnel needs.
 *
 * `dev-access-wizard.ps1` takes the first free of five candidate local ports
 * and forwards it to the app's loopback port on the server. Anything that
 * assumes the local side is 3001 will reach whatever else is bound there — the
 * same shape of bug as a port check that matched `:38209` when it meant `:3820`.
 */

import { execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { promisify } from 'node:util';

const run = promisify(execFile);

export const HOST = '106.55.2.218';
export const ADMIN_USER = 'ubuntu';
export const TUNNEL_USER = 'devtunnel';
export const REMOTE_PORT = 3001;
export const LOCAL_CANDIDATES = [3001, 13001, 23001, 33001, 43001];

const SSH_OPTS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'StrictHostKeyChecking=accept-new'];

/** Run a command over the admin shell. Reads only — see SKILL.md rule 1. */
export async function ssh(command, { timeout = 45000 } = {}) {
  const { stdout } = await run('ssh', [...SSH_OPTS, `${ADMIN_USER}@${HOST}`, command], {
    timeout,
    maxBuffer: 8 * 1024 * 1024,
  });
  return stdout;
}

/** @returns {Promise<boolean>} whether the admin route is usable at all. */
export async function adminReachable() {
  try {
    return (await ssh('echo ok', { timeout: 20000 })).trim() === 'ok';
  } catch {
    return false;
  }
}

async function isFree(port) {
  return new Promise((done) => {
    const probe = createServer();
    probe.once('error', () => done(false));
    probe.once('listening', () => probe.close(() => done(true)));
    probe.listen(port, '127.0.0.1');
  });
}

/** The wizard's own rule: first free candidate, else any free port. */
export async function pickLocalPort() {
  for (const p of LOCAL_CANDIDATES) if (await isFree(p)) return p;
  return new Promise((done) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => done(port));
    });
  });
}
