#!/usr/bin/env node
/**
 * Talos Server
 * 
 * Combined HTTP + WebSocket server for:
 * - REST API for task management
 * - WebSocket for real-time streaming
 * - ACP integration with Copilot CLI
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { createAgent, detectAvailableAgents, getDefaultAgent } = require('./agents');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const WEB_DIR = path.join(__dirname, '..', 'web');

// WebSocket clients
const wsClients = new Set();

// Current agent instance
let currentAgent = null;
let currentTaskId = null;
let activeAgentId = null;

// ============================================
// Config & Task Management
// ============================================

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function getTasksDir() {
  const config = loadConfig();
  return path.resolve(path.dirname(CONFIG_PATH), config.tasksDir);
}

function ensureDirs() {
  const tasksDir = getTasksDir();
  for (const dir of ['queue', 'running', 'done', 'failed']) {
    const p = path.join(tasksDir, dir);
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  }
}

function readTasks(status) {
  const dir = path.join(getTasksDir(), status);
  if (!fs.existsSync(dir)) return [];
  
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      const content = fs.readFileSync(path.join(dir, f), 'utf-8');
      return { ...JSON.parse(content), _file: f, _status: status };
    })
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

function getAllTasks() {
  return {
    queue: readTasks('queue'),
    running: readTasks('running'),
    done: readTasks('done'),
    failed: readTasks('failed')
  };
}

function createTask(data) {
  const task = {
    id: randomUUID().slice(0, 8),
    title: data.title || 'Untitled Task',
    prompt: data.prompt || '',
    type: data.type || 'shell',
    workingDir: data.workingDir || null,
    createdAt: new Date().toISOString()
  };
  
  const queueDir = path.join(getTasksDir(), 'queue');
  if (!fs.existsSync(queueDir)) fs.mkdirSync(queueDir, { recursive: true });
  
  fs.writeFileSync(path.join(queueDir, `${task.id}.json`), JSON.stringify(task, null, 2));
  return task;
}

function moveTask(taskId, fromStatus, toStatus) {
  const tasksDir = getTasksDir();
  const fromDir = path.join(tasksDir, fromStatus);
  const toDir = path.join(tasksDir, toStatus);
  
  const files = fs.readdirSync(fromDir).filter(f => f.startsWith(taskId));
  if (files.length === 0) return null;
  
  const filename = files[0];
  fs.renameSync(path.join(fromDir, filename), path.join(toDir, filename));
  return { id: taskId, from: fromStatus, to: toStatus };
}

function updateTask(taskId, status, updates) {
  const dir = path.join(getTasksDir(), status);
  const files = fs.readdirSync(dir).filter(f => f.startsWith(taskId));
  if (files.length === 0) return null;
  
  const filepath = path.join(dir, files[0]);
  const task = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
  Object.assign(task, updates);
  fs.writeFileSync(filepath, JSON.stringify(task, null, 2));
  return task;
}

function deleteTask(taskId, status) {
  const dir = path.join(getTasksDir(), status);
  const files = fs.readdirSync(dir).filter(f => f.startsWith(taskId));
  if (files.length === 0) return false;
  fs.unlinkSync(path.join(dir, files[0]));
  return true;
}

// ============================================
// WebSocket
// ============================================

function broadcast(type, data) {
  const message = JSON.stringify({ type, data, timestamp: Date.now() });
  for (const client of wsClients) {
    if (client.readyState === 1) { // OPEN
      client.send(message);
    }
  }
}

function handleWebSocket(req, socket, head) {
  // Basic WebSocket handshake
  const key = req.headers['sec-websocket-key'];
  const magic = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
  const accept = require('crypto')
    .createHash('sha1')
    .update(key + magic)
    .digest('base64');

  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n` +
    '\r\n'
  );

  wsClients.add(socket);
  console.log(`[WS] Client connected (${wsClients.size} total)`);

  socket.on('data', (buffer) => {
    const message = parseWebSocketFrame(buffer);
    if (message) {
      handleWSMessage(socket, message);
    }
  });

  socket.on('close', () => {
    wsClients.delete(socket);
    console.log(`[WS] Client disconnected (${wsClients.size} total)`);
  });

  socket.on('error', (err) => {
    console.error('[WS] Error:', err.message);
    wsClients.delete(socket);
  });
}

function parseWebSocketFrame(buffer) {
  if (buffer.length < 2) return null;
  
  const opcode = buffer[0] & 0x0f;
  if (opcode === 0x08) return null; // Close frame
  if (opcode !== 0x01) return null; // Only handle text frames
  
  const masked = (buffer[1] & 0x80) !== 0;
  let payloadLength = buffer[1] & 0x7f;
  let offset = 2;
  
  if (payloadLength === 126) {
    payloadLength = buffer.readUInt16BE(2);
    offset = 4;
  } else if (payloadLength === 127) {
    payloadLength = Number(buffer.readBigUInt64BE(2));
    offset = 10;
  }
  
  let maskKey = null;
  if (masked) {
    maskKey = buffer.slice(offset, offset + 4);
    offset += 4;
  }
  
  let payload = buffer.slice(offset, offset + payloadLength);
  
  if (masked && maskKey) {
    for (let i = 0; i < payload.length; i++) {
      payload[i] ^= maskKey[i % 4];
    }
  }
  
  try {
    return JSON.parse(payload.toString());
  } catch {
    return payload.toString();
  }
}

function sendWebSocketFrame(socket, data) {
  const payload = Buffer.from(JSON.stringify(data));
  const frame = [];
  
  frame.push(0x81); // FIN + text opcode
  
  if (payload.length < 126) {
    frame.push(payload.length);
  } else if (payload.length < 65536) {
    frame.push(126);
    frame.push((payload.length >> 8) & 0xff);
    frame.push(payload.length & 0xff);
  } else {
    frame.push(127);
    for (let i = 7; i >= 0; i--) {
      frame.push((payload.length >> (i * 8)) & 0xff);
    }
  }
  
  socket.write(Buffer.concat([Buffer.from(frame), payload]));
}

function handleWSMessage(socket, message) {
  console.log('[WS] Received:', message);
  
  if (message.type === 'permission_response' && currentAgent) {
    // Forward permission response to agent
    currentAgent.emit('permission_response', message.data);
  }
  
  if (message.type === 'run_task') {
    runTask(message.taskId);
  }
  
  if (message.type === 'stop_task') {
    stopTask();
  }
}

// ============================================
// Task Execution
// ============================================

async function runTask(taskId) {
  if (currentTaskId) {
    broadcast('error', { message: 'A task is already running' });
    return;
  }

  const config = loadConfig();
  const tasksDir = getTasksDir();
  
  // Find task in queue
  const queueDir = path.join(tasksDir, 'queue');
  const files = fs.readdirSync(queueDir).filter(f => f.startsWith(taskId));
  if (files.length === 0) {
    broadcast('error', { message: 'Task not found in queue' });
    return;
  }

  // Load and move to running
  const taskPath = path.join(queueDir, files[0]);
  const task = JSON.parse(fs.readFileSync(taskPath, 'utf-8'));
  const filename = files[0];
  
  const runningPath = path.join(tasksDir, 'running', filename);
  fs.renameSync(taskPath, runningPath);
  
  currentTaskId = task.id;
  
  broadcast('task_started', { task });
  console.log(`[Task] Starting: ${task.id} - ${task.title}`);

  // Determine which agent to use
  let agentId = config.agent?.type || 'auto';
  
  if (agentId === 'auto') {
    agentId = await getDefaultAgent(config.agent?.preferred);
    if (!agentId) {
      throw new Error('No coding agent available. Install copilot or claude CLI.');
    }
  }

  // Build agent-specific config
  const agentConfig = {
    permissions: config.permissions,
    model: config.model,
    planMode: config.planMode,
    ...(agentId === 'copilot' ? config.copilot : {}),
    ...(agentId === 'claude-code' ? config.claudeCode : {})
  };

  // Map legacy config fields
  if (agentId === 'copilot' && config.copilot) {
    agentConfig.copilotCommand = config.copilot.command;
    agentConfig.execution = config.copilot.execution;
  }
  if (agentId === 'claude-code' && config.claudeCode) {
    agentConfig.claudeCommand = config.claudeCode.command;
    agentConfig.execution = config.claudeCode.execution;
  }

  // Create agent
  currentAgent = createAgent(agentId, agentConfig);
  activeAgentId = agentId;
  
  console.log(`[Agent] Using: ${agentId}`);
  broadcast('info', { message: `Using agent: ${agentId}` });

  // Set up event handlers
  currentAgent.on('chunk', (data) => {
    broadcast('output_chunk', { taskId: task.id, ...data });
  });

  currentAgent.on('tool_use', (data) => {
    broadcast('tool_use', { taskId: task.id, ...data });
  });

  currentAgent.on('tool_result', (data) => {
    broadcast('tool_result', { taskId: task.id, ...data });
  });

  currentAgent.on('permission', (data) => {
    broadcast('permission_request', { taskId: task.id, ...data });
  });

  currentAgent.on('stderr', (data) => {
    broadcast('stderr', { taskId: task.id, ...data });
  });

  currentAgent.on('error', (data) => {
    broadcast('error', { taskId: task.id, ...data });
  });

  currentAgent.on('info', (data) => {
    broadcast('info', { taskId: task.id, ...data });
  });

  // Permission handler - forward to clients
  const permissionHandler = async (params) => {
    broadcast('permission_request', {
      taskId: task.id,
      tool: params.tool,
      args: params.args,
      description: params.description
    });
    
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        const autoApprove = config.permissions?.allowAllTools;
        resolve({ outcome: autoApprove ? 'approved' : 'cancelled' });
      }, 30000);
      
      const handler = (response) => {
        clearTimeout(timeout);
        resolve({ outcome: response.approved ? 'approved' : 'cancelled' });
      };
      
      currentAgent.once('permission_response', handler);
    });
  };

  try {
    const result = await currentAgent.execute(task, { permissionHandler });
    
    // Store result in task
    task.result = result;
    
    // Save and move to done
    fs.writeFileSync(runningPath, JSON.stringify(task, null, 2));
    fs.renameSync(runningPath, path.join(tasksDir, 'done', filename));
    
    broadcast('task_completed', { task });
    console.log(`[Task] Completed: ${task.id} (agent: ${agentId})`);
    
  } catch (err) {
    // Store error in task
    task.result = {
      exitCode: 1,
      error: err.message,
      agent: agentId
    };
    
    // Save and move to failed
    fs.writeFileSync(runningPath, JSON.stringify(task, null, 2));
    fs.renameSync(runningPath, path.join(tasksDir, 'failed', filename));
    
    broadcast('task_failed', { task, error: err.message });
    console.log(`[Task] Failed: ${task.id} - ${err.message}`);
    
  } finally {
    currentAgent = null;
    currentTaskId = null;
    activeAgentId = null;
  }
}

async function stopTask() {
  if (currentAgent) {
    await currentAgent.stop();
    currentAgent = null;
    currentTaskId = null;
    activeAgentId = null;
  }
}

// ============================================
// HTTP Server
// ============================================

function serveStatic(res, filePath, contentType) {
  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

function jsonResponse(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch { resolve({}); }
    });
  });
}

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json'
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API Routes
  if (pathname === '/api/tasks' && req.method === 'GET') {
    return jsonResponse(res, getAllTasks());
  }

  if (pathname === '/api/tasks' && req.method === 'POST') {
    const body = await parseBody(req);
    
    // Support batch creation with array
    if (Array.isArray(body)) {
      const tasks = body.map(t => createTask(t));
      tasks.forEach(task => broadcast('task_created', { task }));
      return jsonResponse(res, tasks, 201);
    }
    
    const task = createTask(body);
    broadcast('task_created', { task });
    return jsonResponse(res, task, 201);
  }

  if (pathname.startsWith('/api/tasks/') && pathname.endsWith('/run') && req.method === 'POST') {
    const taskId = pathname.split('/')[3];
    runTask(taskId);
    return jsonResponse(res, { status: 'started', taskId });
  }

  if (pathname.startsWith('/api/tasks/') && req.method === 'DELETE') {
    const taskId = pathname.split('/')[3];
    const status = url.searchParams.get('status') || 'queue';
    const deleted = deleteTask(taskId, status);
    if (deleted) broadcast('task_deleted', { taskId, status });
    return jsonResponse(res, { deleted }, deleted ? 200 : 404);
  }

  if (pathname === '/api/tasks/move' && req.method === 'POST') {
    const body = await parseBody(req);
    const result = moveTask(body.taskId, body.from, body.to);
    if (result) broadcast('task_moved', result);
    return jsonResponse(res, result || { error: 'Not found' }, result ? 200 : 404);
  }

  if (pathname === '/api/config' && req.method === 'GET') {
    return jsonResponse(res, loadConfig());
  }

  if (pathname === '/api/config' && req.method === 'PUT') {
    const body = await parseBody(req);
    const config = loadConfig();
    Object.assign(config, body);
    saveConfig(config);
    return jsonResponse(res, config);
  }

  if (pathname === '/api/status' && req.method === 'GET') {
    return jsonResponse(res, {
      running: currentTaskId !== null,
      currentTask: currentTaskId,
      activeAgent: activeAgentId,
      wsClients: wsClients.size
    });
  }

  if (pathname === '/api/agents' && req.method === 'GET') {
    const agents = await detectAvailableAgents();
    const config = loadConfig();
    return jsonResponse(res, {
      configured: config.agent?.type || 'auto',
      preferred: config.agent?.preferred || ['copilot', 'claude-code'],
      available: agents
    });
  }

  if (pathname === '/api/templates' && req.method === 'GET') {
    const config = loadConfig();
    return jsonResponse(res, config.templates || []);
  }

  if (pathname === '/api/stop' && req.method === 'POST') {
    await stopTask();
    return jsonResponse(res, { stopped: true });
  }

  if (pathname === '/api/health' && req.method === 'GET') {
    return jsonResponse(res, {
      status: 'healthy',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      version: require('../package.json').version
    });
  }

  if (pathname === '/api/stats' && req.method === 'GET') {
    const stats = {
      queue: readTasks('queue').length,
      running: readTasks('running').length,
      done: readTasks('done').length,
      failed: readTasks('failed').length
    };
    const doneTasks = readTasks('done');
    const totalDuration = doneTasks.reduce((sum, t) => sum + (t.result?.durationMs || 0), 0);
    stats.avgDurationMs = doneTasks.length > 0 ? totalDuration / doneTasks.length : 0;
    stats.successRate = stats.done + stats.failed > 0 
      ? stats.done / (stats.done + stats.failed) 
      : null;
    return jsonResponse(res, stats);
  }

  // Static files
  if (pathname === '/' || pathname === '/index.html') {
    return serveStatic(res, path.join(WEB_DIR, 'index.html'), 'text/html');
  }

  const ext = path.extname(pathname);
  if (MIME_TYPES[ext]) {
    return serveStatic(res, path.join(WEB_DIR, pathname), MIME_TYPES[ext]);
  }

  res.writeHead(404);
  res.end('Not found');
});

// WebSocket upgrade
server.on('upgrade', (req, socket, head) => {
  if (req.url === '/ws') {
    handleWebSocket(req, socket, head);
  } else {
    socket.destroy();
  }
});

// Start server
const config = loadConfig();
const port = config.webPort || 3000;

ensureDirs();
server.listen(port, '0.0.0.0', () => {
  console.log('='.repeat(60));
  console.log('  Talos Server - GitHub Copilot CLI Task Queue');
  console.log('='.repeat(60));
  console.log(`HTTP:      http://localhost:${port}`);
  console.log(`WebSocket: ws://localhost:${port}/ws`);
  console.log(`Tasks:     ${getTasksDir()}`);
  console.log('');
});
