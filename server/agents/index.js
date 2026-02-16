/**
 * Agent Registry
 * 
 * Manages available coding agents and provides factory methods.
 */

const { BaseAgent } = require('./base');
const { CopilotAgent } = require('./copilot');
const { ClaudeCodeAgent } = require('./claude-code');

// Registry of all known agent adapters
const AGENTS = {
  'copilot': CopilotAgent,
  'claude-code': ClaudeCodeAgent
};

/**
 * Get list of all registered agent IDs
 * @returns {string[]}
 */
function getAgentIds() {
  return Object.keys(AGENTS);
}

/**
 * Get agent class by ID
 * @param {string} id - Agent identifier
 * @returns {typeof BaseAgent|null}
 */
function getAgentClass(id) {
  return AGENTS[id] || null;
}

/**
 * Create an agent instance
 * @param {string} id - Agent identifier
 * @param {Object} config - Agent configuration
 * @returns {BaseAgent}
 */
function createAgent(id, config = {}) {
  const AgentClass = AGENTS[id];
  if (!AgentClass) {
    throw new Error(`Unknown agent: ${id}. Available: ${Object.keys(AGENTS).join(', ')}`);
  }
  return new AgentClass(config);
}

/**
 * Check which agents are available on this system
 * @returns {Promise<Object[]>} Array of { id, name, available, version }
 */
async function detectAvailableAgents() {
  const results = [];
  
  for (const [id, AgentClass] of Object.entries(AGENTS)) {
    const available = await AgentClass.isAvailable();
    let version = null;
    
    if (available) {
      version = await AgentClass.getVersion();
    }
    
    results.push({
      id,
      name: AgentClass.name,
      available,
      version,
      capabilities: AgentClass.capabilities
    });
  }
  
  return results;
}

/**
 * Get the first available agent, with preference order
 * @param {string[]} [preferred] - Preferred agent order
 * @returns {Promise<string|null>} Agent ID or null if none available
 */
async function getDefaultAgent(preferred = ['copilot', 'claude-code']) {
  for (const id of preferred) {
    const AgentClass = AGENTS[id];
    if (AgentClass && await AgentClass.isAvailable()) {
      return id;
    }
  }
  return null;
}

/**
 * Get agent info by ID
 * @param {string} id - Agent identifier
 * @returns {Object|null}
 */
function getAgentInfo(id) {
  const AgentClass = AGENTS[id];
  if (!AgentClass) return null;
  
  return {
    id: AgentClass.id,
    name: AgentClass.name,
    capabilities: AgentClass.capabilities
  };
}

module.exports = {
  BaseAgent,
  CopilotAgent,
  ClaudeCodeAgent,
  AGENTS,
  getAgentIds,
  getAgentClass,
  createAgent,
  detectAvailableAgents,
  getDefaultAgent,
  getAgentInfo
};
