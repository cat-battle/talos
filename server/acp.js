/**
 * ACP (Agent Client Protocol) client for GitHub Copilot CLI
 * 
 * Protocol: NDJSON over stdio
 * Docs: https://agentclientprotocol.com/protocol/overview
 */

const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const readline = require('readline');

const PROTOCOL_VERSION = '2025-01-01';

class ACPClient extends EventEmitter {
  constructor(options = {}) {
    super();
    this.copilotCommand = options.copilotCommand || 'copilot';
    this.process = null;
    this.sessionId = null;
    this.requestId = 0;
    this.pendingRequests = new Map();
    this.permissionHandler = options.permissionHandler || (() => ({ outcome: 'approved' }));
  }

  /**
   * Start the ACP server process
   */
  async start(cwd = process.cwd()) {
    return new Promise((resolve, reject) => {
      this.process = spawn(this.copilotCommand, ['--acp', '--stdio'], {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env }
      });

      this.process.on('error', (err) => {
        this.emit('error', err);
        reject(err);
      });

      this.process.on('exit', (code) => {
        this.emit('exit', code);
      });

      // Read NDJSON from stdout
      const rl = readline.createInterface({
        input: this.process.stdout,
        crlfDelay: Infinity
      });

      rl.on('line', (line) => {
        try {
          const message = JSON.parse(line);
          this._handleMessage(message);
        } catch (e) {
          this.emit('error', new Error(`Failed to parse ACP message: ${line}`));
        }
      });

      // Forward stderr
      this.process.stderr.on('data', (data) => {
        this.emit('stderr', data.toString());
      });

      // Initialize the connection
      this._initialize(cwd).then(resolve).catch(reject);
    });
  }

  /**
   * Send a message to the ACP server
   */
  _send(message) {
    if (!this.process || !this.process.stdin.writable) {
      throw new Error('ACP process not running');
    }
    const json = JSON.stringify(message);
    this.process.stdin.write(json + '\n');
  }

  /**
   * Send a request and wait for response
   */
  _request(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      this.pendingRequests.set(id, { resolve, reject });
      this._send({ jsonrpc: '2.0', id, method, params });
      
      // Timeout after 60 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request ${method} timed out`));
        }
      }, 60000);
    });
  }

  /**
   * Handle incoming ACP message
   */
  _handleMessage(message) {
    // Response to a request
    if (message.id && this.pendingRequests.has(message.id)) {
      const { resolve, reject } = this.pendingRequests.get(message.id);
      this.pendingRequests.delete(message.id);
      
      if (message.error) {
        reject(new Error(message.error.message || 'ACP error'));
      } else {
        resolve(message.result);
      }
      return;
    }

    // Notification from server
    if (message.method) {
      this._handleNotification(message);
      return;
    }

    // Session update (streaming)
    if (message.params?.update) {
      this._handleSessionUpdate(message.params.update);
      return;
    }
  }

  /**
   * Handle server notifications
   */
  async _handleNotification(message) {
    const { method, params } = message;

    switch (method) {
      case 'requestPermission':
        // Forward to permission handler and respond
        const decision = await this.permissionHandler(params);
        this._send({
          jsonrpc: '2.0',
          id: message.id,
          result: { outcome: decision }
        });
        this.emit('permission', { request: params, decision });
        break;

      case 'sessionUpdate':
        this._handleSessionUpdate(params.update);
        break;

      default:
        this.emit('notification', message);
    }
  }

  /**
   * Handle streaming session updates
   */
  _handleSessionUpdate(update) {
    switch (update.sessionUpdate) {
      case 'agent_message_chunk':
        if (update.content?.type === 'text') {
          this.emit('chunk', update.content.text);
        } else if (update.content?.type === 'tool_use') {
          this.emit('tool_use', update.content);
        }
        break;

      case 'agent_message_start':
        this.emit('message_start', update);
        break;

      case 'agent_message_end':
        this.emit('message_end', update);
        break;

      case 'tool_result':
        this.emit('tool_result', update);
        break;

      default:
        this.emit('update', update);
    }
  }

  /**
   * Initialize the ACP connection
   */
  async _initialize(cwd) {
    const result = await this._request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {
        streaming: true
      }
    });
    
    this.emit('initialized', result);
    return result;
  }

  /**
   * Create a new session
   */
  async newSession(cwd = process.cwd(), mcpServers = []) {
    const result = await this._request('newSession', {
      cwd,
      mcpServers
    });
    
    this.sessionId = result.sessionId;
    this.emit('session', result);
    return result;
  }

  /**
   * Send a prompt to the current session
   */
  async prompt(text) {
    if (!this.sessionId) {
      throw new Error('No active session. Call newSession() first.');
    }

    const result = await this._request('prompt', {
      sessionId: this.sessionId,
      prompt: [{ type: 'text', text }]
    });

    this.emit('prompt_complete', result);
    return result;
  }

  /**
   * Stop the ACP process
   */
  async stop() {
    if (this.process) {
      this.process.stdin.end();
      this.process.kill('SIGTERM');
      
      await new Promise((resolve) => {
        this.process.once('exit', resolve);
        setTimeout(resolve, 2000);
      });
      
      this.process = null;
      this.sessionId = null;
    }
  }
}

module.exports = { ACPClient };
