// routes/run.mjs — Trasy: uruchamianie snapshotów
import { Router } from 'express';
import fs from 'fs-extra';
import path from 'path';
import AdmZip from 'adm-zip';
import { spawn } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import os from 'os';
import { config } from '../core/utils.js';

const router = Router();
const dataDir       = config.dataDir;
const activeSessions = new Map();

// Cleanup
process.on('SIGTERM', () => {
  activeSessions.forEach(s => {
    if (s.process) s.process.kill();
    fs.remove(s.workDir).catch(() => {});
  });
});

// ── Detect project type & actions ──────────────────────────────────────────
async function detectProject(workDir) {
  const hasPkg  = await fs.pathExists(path.join(workDir, 'package.json'));
  const hasReq  = await fs.pathExists(path.join(workDir, 'requirements.txt'));
  const pyFiles = (await fs.readdir(workDir)).filter(f => f.endsWith('.py'));
  const actions = [];
  let projectType = 'unknown';

  if (hasPkg) {
    projectType = 'node';
    actions.push({ id:'install', label:'📦 Zainstaluj zależności', cmd:'npm', args:['install'], color:'blue' });
    const pkg = await fs.readJson(path.join(workDir, 'package.json'));
    if (pkg.scripts) {
      Object.keys(pkg.scripts).forEach(s => actions.push(
        { id:`script_${s}`, label:`▶️ npm run ${s}`, cmd:'npm', args:['run', s], color:'green' }));
    }
  } else if (hasReq || pyFiles.length) {
    projectType = 'python';
    if (hasReq) actions.push({ id:'install', label:'📦 Zainstaluj wymagania',
      cmd:'pip3', args:['install','-r','requirements.txt'], color:'blue' });
    pyFiles.forEach(f => actions.push(
      { id:`run_${f}`, label:`▶️ python ${f}`, cmd:'python3', args:[f], color:'green' }));
  }
  return { projectType, actions };
}

// 1. Prepare session
router.post('/repos/:id/run/:commitFile', async (req, res) => {
  try {
    const { id, commitFile } = req.params;
    const sessionId = uuidv4();
    const workDir   = path.join(os.tmpdir(), `mygit_run_${sessionId}`);
    const zipPath   = path.join(dataDir, 'repos', id, 'versions', commitFile);

    if (!(await fs.pathExists(zipPath)))
      return res.status(404).json({ error: 'Snapshot nie istnieje' });

    await fs.ensureDir(workDir);
    new AdmZip(zipPath).extractAllTo(workDir, true);

    const { projectType, actions } = await detectProject(workDir);

    activeSessions.set(sessionId, { workDir, process:null, repoId:id,
      commitFile, output:[], exited:false, exitCode:null });

    res.json({ sessionId, workDir, projectType, actions });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 2. Start process
router.post('/run/:sessionId/start', async (req, res) => {
  const session = activeSessions.get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Sesja nie istnieje' });
  try {
    const { cmd, args } = req.body;
    session.output = []; session.exited = false; session.exitCode = null;
    const proc = spawn(cmd, args, {
      cwd: session.workDir, shell: true,
      env: { ...process.env, FORCE_COLOR:'1' }
    });
    session.process = proc;
    proc.stdout.on('data', d => session.output.push({ type:'stdout', text: d.toString() }));
    proc.stderr.on('data', d => session.output.push({ type:'stderr', text: d.toString() }));
    proc.on('close', code => {
      session.exited = true; session.exitCode = code; session.process = null;
    });
    proc.on('error', err => {
      session.output.push({ type:'error', text:`Error: ${err.message}` });
      session.exited = true; session.exitCode = -1; session.process = null;
    });
    res.json({ success:true, sessionId: req.params.sessionId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 3. Poll output
router.get('/run/:sessionId/output', (req, res) => {
  const session = activeSessions.get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Sesja nie istnieje' });
  const from = parseInt(req.query.from || '0');
  res.json({ lines: session.output.slice(from), lastLine: session.output.length,
    exited: session.exited, exitCode: session.exitCode });
});

// 4. Kill
router.post('/run/:sessionId/kill', (req, res) => {
  const session = activeSessions.get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Sesja nie istnieje' });
  if (session.process) {
    session.process.kill('SIGTERM');
    setTimeout(() => { if (session.process) session.process.kill('SIGKILL'); }, 3000);
  }
  res.json({ success: true });
});

// 5. Cleanup session
router.delete('/run/:sessionId', async (req, res) => {
  const session = activeSessions.get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Sesja nie istnieje' });
  if (session.process) session.process.kill('SIGKILL');
  try { await fs.remove(session.workDir); } catch {}
  activeSessions.delete(req.params.sessionId);
  res.json({ success: true });
});

export default router;
