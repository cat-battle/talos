#!/usr/bin/env node
/**
 * Talos Web Server
 * Serves kanban UI and REST API for task management
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

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
  
  const tasksDir = getTasksDir();
  const queueDir = path.join(tasksDir, 'queue');
  if (!fs.existsSync(queueDir)) fs.mkdirSync(queueDir, { recursive: true });
  
  const filename = `${task.id}.json`;
  fs.writeFileSync(path.join(queueDir, filename), JSON.stringify(task, null, 2));
  
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

function deleteTask(taskId, status) {
  const tasksDir = getTasksDir();
  const dir = path.join(tasksDir, status);
  
  const files = fs.readdirSync(dir).filter(f => f.startsWith(taskId));
  if (files.length === 0) return false;
  
  fs.unlinkSync(path.join(dir, files[0]));
  return true;
}

function serveStatic(res, filePath, contentType) {
  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch (e) {
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
      try {
        resolve(JSON.parse(body));
      } catch {
        resolve({});
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API routes
  if (pathname === '/api/tasks' && req.method === 'GET') {
    return jsonResponse(res, getAllTasks());
  }

  if (pathname === '/api/tasks' && req.method === 'POST') {
    const body = await parseBody(req);
    const task = createTask(body);
    return jsonResponse(res, task, 201);
  }

  if (pathname.startsWith('/api/tasks/') && req.method === 'DELETE') {
    const parts = pathname.split('/');
    const taskId = parts[3];
    const status = url.searchParams.get('status') || 'queue';
    const deleted = deleteTask(taskId, status);
    return jsonResponse(res, { deleted }, deleted ? 200 : 404);
  }

  if (pathname === '/api/tasks/move' && req.method === 'POST') {
    const body = await parseBody(req);
    const result = moveTask(body.taskId, body.from, body.to);
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

  // Static files
  if (pathname === '/' || pathname === '/index.html') {
    return serveStatic(res, path.join(__dirname, 'index.html'), 'text/html');
  }

  if (pathname.endsWith('.css')) {
    return serveStatic(res, path.join(__dirname, pathname), 'text/css');
  }

  if (pathname.endsWith('.js')) {
    return serveStatic(res, path.join(__dirname, pathname), 'application/javascript');
  }

  res.writeHead(404);
  res.end('Not found');
});

const config = loadConfig();
const port = config.webPort || 3000;

server.listen(port, '0.0.0.0', () => {
  console.log(`Talos web UI running at http://localhost:${port}`);
});
