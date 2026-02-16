/**
 * Base Agent Adapter
 * 
 * Abstract interface that all coding agent adapters must implement.
 * Provides a unified API for task execution regardless of the underlying agent.
 */

const { EventEmitter } = require('events');

/**
 * @typedef {Object} AgentCapabilities
 * @property {boolean} streaming - Supports streaming output
 * @property {boolean} interactive - Supports interactive permission prompts
 * @property {boolean} sessionResume - Can resume previous sessions
 * @property {boolean} planMode - Supports plan/think mode
 * @property {string[]} tools - Available tool types
 */

/**
 * @typedef {Object} ExecutionResult
 * @property {number} exitCode - Process exit code (0 = success)
 * @property {string} output - Captured output text
 * @property {string} [error] - Error message if failed
 * @property {number} durationMs - Execution time in milliseconds
 * @property {string} agent - Agent identifier (e.g., 'copilot', 'claude-code')
 * @property {string} [stopReason] - Why execution stopped
 */

class BaseAgent extends EventEmitter {
  /**
   * @param {Object} config - Agent configuration
   */
  constructor(config = {}) {
    super();
    this.config = config;
    this.running = false;
  }

  /**
   * Agent identifier (override in subclass)
   * @returns {string}
   */
  static get id() {
    throw new Error('Subclass must implement static id getter');
  }

  /**
   * Human-readable agent name (override in subclass)
   * @returns {string}
   */
  static get name() {
    throw new Error('Subclass must implement static name getter');
  }

  /**
   * Get agent capabilities (override in subclass)
   * @returns {AgentCapabilities}
   */
  static get capabilities() {
    return {
      streaming: false,
      interactive: false,
      sessionResume: false,
      planMode: false,
      tools: []
    };
  }

  /**
   * Check if the agent is available on this system
   * @returns {Promise<boolean>}
   */
  static async isAvailable() {
    throw new Error('Subclass must implement static isAvailable()');
  }

  /**
   * Get version information
   * @returns {Promise<string>}
   */
  static async getVersion() {
    return 'unknown';
  }

  /**
   * Execute a task
   * 
   * Events emitted during execution:
   * - 'started' - Execution began
   * - 'chunk' - Output text chunk { text: string }
   * - 'tool_use' - Tool invocation { tool: string, args: any }
   * - 'tool_result' - Tool completed { tool: string, result: any }
   * - 'permission' - Permission request { tool: string, description: string }
   * - 'completed' - Execution finished successfully
   * - 'failed' - Execution failed { error: string }
   * - 'stderr' - Stderr output { text: string }
   * - 'info' - Informational message { message: string }
   * 
   * @param {Object} task - Task to execute
   * @param {string} task.prompt - The prompt/instruction
   * @param {string} [task.workingDir] - Working directory
   * @param {Object} [options] - Execution options
   * @param {Function} [options.permissionHandler] - Handler for permission requests
   * @returns {Promise<ExecutionResult>}
   */
  async execute(task, options = {}) {
    throw new Error('Subclass must implement execute()');
  }

  /**
   * Stop current execution
   * @returns {Promise<void>}
   */
  async stop() {
    throw new Error('Subclass must implement stop()');
  }

  /**
   * Send a permission response (for interactive agents)
   * @param {boolean} approved - Whether the permission was approved
   */
  sendPermissionResponse(approved) {
    // Default no-op, override in interactive agents
  }

  /**
   * Build command line arguments from config
   * @param {Object} task - The task
   * @returns {string[]}
   */
  buildArgs(task) {
    return [];
  }

  /**
   * Helper to emit info messages
   * @param {string} message
   */
  info(message) {
    this.emit('info', { message });
  }
}

module.exports = { BaseAgent };
