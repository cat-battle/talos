/**
 * Task Executor
 * 
 * Handles execution of tasks via Copilot CLI using either:
 * - ACP mode (streaming, interactive)
 * - Prompt mode (fallback, simpler)
 */

const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const { ACPClient } = require('./acp');

class TaskExecutor extends EventEmitter {
  constructor(config, memory = null) {
    super();
    this.config = config;
    this.memory = memory;
    this.currentTask = null;
    this.acpClient = null;
    this.process = null;
  }

  /**
   * Execute a task using the configured mode
   */
  async execute(task, permissionHandler) {
    this.currentTask = task;
    task.startedAt = new Date().toISOString();
    task.output = '';

    // Inject memory context into prompt
    if (this.memory) {
      const contextPrompt = this.memory.buildContextPrompt(task);
      if (contextPrompt) {
        task._originalPrompt = task.prompt;
        task.prompt = task.prompt + contextPrompt;
        this.emit('info', { message: 'Injected memory context into prompt' });
      }
    }

    const mode = this.config.execution?.mode || 'acp';
    const fallback = this.config.execution?.fallbackToPrompt !== false;

    this.emit('started', { task });

    try {
      if (mode === 'acp') {
        await this._executeACP(task, permissionHandler);
      } else {
        await this._executePrompt(task);
      }
    } catch (err) {
      // Try fallback if ACP fails and fallback is enabled
      if (mode === 'acp' && fallback && err.message.includes('ACP')) {
        this.emit('info', { message: 'ACP failed, falling back to prompt mode' });
        try {
          await this._executePrompt(task);
          return;
        } catch (fallbackErr) {
          throw fallbackErr;
        }
      }
      throw err;
    } finally {
      // Record task in memory
      if (this.memory && task.result) {
        try {
          // Restore original prompt for recording
          if (task._originalPrompt) {
            task.prompt = task._originalPrompt;
            delete task._originalPrompt;
          }
          this.memory.recordTask(task, task.result);
          
          // Extract and save learnings
          const learnings = this.memory.extractLearnings(task, task.result);
          for (const learning of learnings) {
            this.memory.addLearning(task.workingDir, learning);
          }
        } catch (memErr) {
          this.emit('error', { message: `Memory recording failed: ${memErr.message}` });
        }
      }
      this.currentTask = null;
    }
  }

  /**
   * Execute using ACP (Agent Client Protocol)
   */
  async _executeACP(task, permissionHandler) {
    const workDir = task.workingDir || process.cwd();

    this.acpClient = new ACPClient({
      copilotCommand: this.config.copilotCommand || 'copilot',
      permissionHandler: async (params) => {
        const tool = params.tool || 'unknown';
        
        // Check auto-approve settings from config
        if (this.config.permissions?.allowAllTools) {
          this._recordToolDecision(tool, true);
          return { outcome: 'approved' };
        }

        // Check allowed tools list from config
        const allowedTools = this.config.permissions?.allowTools || [];
        if (allowedTools.some(t => tool.includes(t))) {
          this._recordToolDecision(tool, true);
          return { outcome: 'approved' };
        }

        // Check denied tools list from config
        const deniedTools = this.config.permissions?.denyTools || [];
        if (deniedTools.some(t => tool.includes(t))) {
          this._recordToolDecision(tool, false);
          return { outcome: 'cancelled' };
        }

        // Check memory for auto-approve patterns
        if (this.memory?.shouldAutoApprove(tool)) {
          this.emit('info', { message: `Auto-approved ${tool} (learned pattern)` });
          this._recordToolDecision(tool, true);
          return { outcome: 'approved' };
        }

        // Ask the handler (usually forwards to UI)
        if (permissionHandler) {
          const result = await permissionHandler(params);
          this._recordToolDecision(tool, result.outcome === 'approved');
          return result;
        }

        return { outcome: 'cancelled' };
      }
    });

    // Forward events
    this.acpClient.on('chunk', (text) => {
      task.output += text;
      this.emit('chunk', { taskId: task.id, text });
    });

    this.acpClient.on('tool_use', (tool) => {
      this.emit('tool_use', { taskId: task.id, tool });
    });

    this.acpClient.on('tool_result', (result) => {
      this.emit('tool_result', { taskId: task.id, result });
    });

    this.acpClient.on('permission', (data) => {
      this.emit('permission', { taskId: task.id, ...data });
    });

    this.acpClient.on('stderr', (text) => {
      this.emit('stderr', { taskId: task.id, text });
    });

    this.acpClient.on('error', (err) => {
      this.emit('error', { taskId: task.id, message: err.message });
    });

    try {
      await this.acpClient.start(workDir);
      await this.acpClient.newSession(workDir);
      
      const result = await this.acpClient.prompt(task.prompt);
      
      task.completedAt = new Date().toISOString();
      task.result = {
        exitCode: 0,
        stopReason: result.stopReason,
        output: task.output,
        durationMs: Date.now() - new Date(task.startedAt).getTime(),
        mode: 'acp'
      };

      this.emit('completed', { task });
    } catch (err) {
      task.completedAt = new Date().toISOString();
      task.result = {
        exitCode: 1,
        error: err.message,
        output: task.output,
        durationMs: Date.now() - new Date(task.startedAt).getTime(),
        mode: 'acp'
      };

      this.emit('failed', { task, error: err.message });
      throw err;
    } finally {
      await this.acpClient?.stop();
      this.acpClient = null;
    }
  }

  /**
   * Execute using prompt mode (simpler, non-interactive)
   */
  async _executePrompt(task) {
    const workDir = task.workingDir || process.cwd();
    const command = this.config.copilotCommand || 'copilot';
    const args = this._buildPromptArgs(task);

    this.emit('info', { message: `Executing: ${command} ${args.join(' ')}` });

    return new Promise((resolve, reject) => {
      this.process = spawn(command, args, {
        cwd: workDir,
        env: { ...process.env },
        shell: false
      });

      this.process.stdout.on('data', (data) => {
        const text = data.toString();
        task.output += text;
        this.emit('chunk', { taskId: task.id, text });
      });

      this.process.stderr.on('data', (data) => {
        const text = data.toString();
        task.output += text;
        this.emit('stderr', { taskId: task.id, text });
      });

      this.process.on('error', (err) => {
        task.completedAt = new Date().toISOString();
        task.result = {
          exitCode: -1,
          error: err.message,
          output: task.output,
          durationMs: Date.now() - new Date(task.startedAt).getTime(),
          mode: 'prompt'
        };
        this.emit('failed', { task, error: err.message });
        reject(err);
      });

      this.process.on('close', (code) => {
        task.completedAt = new Date().toISOString();
        task.result = {
          exitCode: code,
          output: task.output,
          durationMs: Date.now() - new Date(task.startedAt).getTime(),
          mode: 'prompt'
        };

        if (code === 0) {
          this.emit('completed', { task });
          resolve(task);
        } else {
          this.emit('failed', { task, error: `Exit code: ${code}` });
          reject(new Error(`Process exited with code ${code}`));
        }
      });
    });
  }

  /**
   * Build command line arguments for prompt mode
   */
  _buildPromptArgs(task) {
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

  /**
   * Stop the current execution
   */
  async stop() {
    if (this.acpClient) {
      await this.acpClient.stop();
      this.acpClient = null;
    }

    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
    }

    if (this.currentTask) {
      this.currentTask.completedAt = new Date().toISOString();
      this.currentTask.result = {
        exitCode: -1,
        error: 'Cancelled by user',
        output: this.currentTask.output,
        durationMs: Date.now() - new Date(this.currentTask.startedAt).getTime()
      };
      this.emit('cancelled', { task: this.currentTask });
      this.currentTask = null;
    }
  }

  /**
   * Send permission response (for ACP mode)
   */
  sendPermissionResponse(approved) {
    if (this.acpClient) {
      this.acpClient.emit('permission_response', { approved });
    }
  }

  /**
   * Record tool approval/denial in memory
   */
  _recordToolDecision(tool, approved) {
    if (this.memory) {
      try {
        this.memory.recordToolDecision(tool, approved);
      } catch (err) {
        // Non-fatal, just log
        this.emit('error', { message: `Failed to record tool decision: ${err.message}` });
      }
    }
  }
}

module.exports = { TaskExecutor };
