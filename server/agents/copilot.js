/**
 * GitHub Copilot CLI Agent Adapter
 * 
 * Supports both ACP (Agent Client Protocol) and prompt modes.
 */

const { spawn, execSync } = require('child_process');
const { BaseAgent } = require('./base');

class CopilotAgent extends BaseAgent {
  constructor(config = {}) {
    super(config);
    this.process = null;
    this.acpClient = null;
    this.output = '';
    this.startTime = null;
  }

  static get id() {
    return 'copilot';
  }

  static get name() {
    return 'GitHub Copilot CLI';
  }

  static get capabilities() {
    return {
      streaming: true,
      interactive: true,
      sessionResume: true,
      planMode: true,
      tools: ['shell', 'write', 'read', 'glob', 'grep']
    };
  }

  static async isAvailable(config = {}) {
    const command = config.command || config.copilotCommand || 'copilot';
    try {
      execSync(`${command} --version`, { stdio: 'ignore' });
      return true;
    } catch {
      // Fallback: check common paths
      const commonPaths = [
        'copilot',
        '/usr/local/bin/copilot',
        '/usr/bin/copilot',
        `${process.env.HOME}/.local/bin/copilot`
      ];
      for (const path of commonPaths) {
        try {
          execSync(`${path} --version`, { stdio: 'ignore' });
          return true;
        } catch {}
      }
      return false;
    }
  }

  static async getVersion(config = {}) {
    const command = config.command || config.copilotCommand || 'copilot';
    try {
      const version = execSync(`${command} --version`, { encoding: 'utf-8' }).trim();
      return version;
    } catch {
      const commonPaths = [
        'copilot',
        `${process.env.HOME}/.local/bin/copilot`
      ];
      for (const path of commonPaths) {
        try {
          return execSync(`${path} --version`, { encoding: 'utf-8' }).trim();
        } catch {}
      }
      return 'unknown';
    }
  }

  async execute(task, options = {}) {
    this.running = true;
    this.output = '';
    this.startTime = Date.now();

    const mode = this.config.execution?.mode || 'prompt';
    const fallback = this.config.execution?.fallbackToPrompt !== false;

    this.emit('started', { task });

    try {
      if (mode === 'acp') {
        return await this._executeACP(task, options);
      } else {
        return await this._executePrompt(task);
      }
    } catch (err) {
      // Try fallback if ACP fails
      if (mode === 'acp' && fallback) {
        this.info('ACP failed, falling back to prompt mode');
        try {
          return await this._executePrompt(task);
        } catch (fallbackErr) {
          throw fallbackErr;
        }
      }
      throw err;
    } finally {
      this.running = false;
    }
  }

  async _executeACP(task, options = {}) {
    // Dynamically import ACP client to avoid circular deps
    const { ACPClient } = require('../acp');
    const workDir = task.workingDir || process.cwd();

    this.acpClient = new ACPClient({
      copilotCommand: this.config.copilotCommand || 'copilot',
      permissionHandler: async (params) => {
        // Check auto-approve settings
        if (this.config.permissions?.allowAllTools) {
          return { outcome: 'approved' };
        }

        const tool = params.tool || 'unknown';

        // Check allowed tools list
        const allowedTools = this.config.permissions?.allowTools || [];
        if (allowedTools.some(t => tool.includes(t))) {
          return { outcome: 'approved' };
        }

        // Check denied tools list
        const deniedTools = this.config.permissions?.denyTools || [];
        if (deniedTools.some(t => tool.includes(t))) {
          return { outcome: 'cancelled' };
        }

        // Forward to handler
        if (options.permissionHandler) {
          this.emit('permission', { tool, ...params });
          return options.permissionHandler(params);
        }

        return { outcome: 'cancelled' };
      }
    });

    // Forward events
    this.acpClient.on('chunk', (text) => {
      this.output += text;
      this.emit('chunk', { text });
    });

    this.acpClient.on('tool_use', (tool) => {
      this.emit('tool_use', { tool });
    });

    this.acpClient.on('tool_result', (result) => {
      this.emit('tool_result', { result });
    });

    this.acpClient.on('stderr', (text) => {
      this.emit('stderr', { text });
    });

    try {
      await this.acpClient.start(workDir);
      await this.acpClient.newSession(workDir);
      
      const result = await this.acpClient.prompt(task.prompt);
      
      const execResult = {
        exitCode: 0,
        output: this.output,
        durationMs: Date.now() - this.startTime,
        agent: CopilotAgent.id,
        stopReason: result.stopReason
      };

      this.emit('completed', { result: execResult });
      return execResult;
    } catch (err) {
      const execResult = {
        exitCode: 1,
        output: this.output,
        error: err.message,
        durationMs: Date.now() - this.startTime,
        agent: CopilotAgent.id
      };

      this.emit('failed', { error: err.message });
      throw err;
    } finally {
      await this.acpClient?.stop();
      this.acpClient = null;
    }
  }

  async _executePrompt(task) {
    const workDir = task.workingDir || process.cwd();
    const command = this.config.copilotCommand || 'copilot';
    const args = this.buildArgs(task);

    this.info(`Executing: ${command} ${args.join(' ')}`);

    return new Promise((resolve, reject) => {
      this.process = spawn(command, args, {
        cwd: workDir,
        env: { ...process.env },
        shell: false
      });

      this.process.stdout.on('data', (data) => {
        const text = data.toString();
        this.output += text;
        this.emit('chunk', { text });
      });

      this.process.stderr.on('data', (data) => {
        const text = data.toString();
        this.output += text;
        this.emit('stderr', { text });
      });

      this.process.on('error', (err) => {
        const result = {
          exitCode: -1,
          output: this.output,
          error: err.message,
          durationMs: Date.now() - this.startTime,
          agent: CopilotAgent.id
        };
        this.emit('failed', { error: err.message });
        reject(err);
      });

      this.process.on('close', (code) => {
        const result = {
          exitCode: code,
          output: this.output,
          durationMs: Date.now() - this.startTime,
          agent: CopilotAgent.id
        };

        if (code === 0) {
          this.emit('completed', { result });
          resolve(result);
        } else {
          result.error = `Process exited with code ${code}`;
          this.emit('failed', { error: result.error });
          reject(new Error(result.error));
        }
      });
    });
  }

  buildArgs(task) {
    const args = ['-p', task.prompt];
    const perms = this.config.permissions || {};

    // Tool permissions
    if (perms.allowAllTools) {
      args.push('--allow-all-tools');
    } else if (perms.allowTools?.length > 0) {
      for (const tool of perms.allowTools) {
        args.push('--allow-tool', tool);
      }
    }

    if (perms.denyTools?.length > 0) {
      for (const tool of perms.denyTools) {
        args.push('--deny-tool', tool);
      }
    }

    // Path permissions
    if (perms.allowAllPaths) {
      args.push('--allow-all-paths');
    }

    // URL permissions
    if (perms.allowAllUrls) {
      args.push('--allow-all-urls');
    } else if (perms.allowUrls?.length > 0) {
      for (const url of perms.allowUrls) {
        args.push('--allow-url', url);
      }
    }

    // Model
    if (this.config.model) {
      args.push('--model', this.config.model);
    }

    // Plan mode
    if (this.config.planMode) {
      args.push('--plan');
    }

    return args;
  }

  async stop() {
    if (this.acpClient) {
      await this.acpClient.stop();
      this.acpClient = null;
    }

    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
    }

    this.running = false;
  }

  sendPermissionResponse(approved) {
    if (this.acpClient) {
      this.acpClient.emit('permission_response', { approved });
    }
  }
}

module.exports = { CopilotAgent };
