#!/usr/bin/env node
// FindMe MCP server — ZERO dependencies. Implements MCP stdio (newline-delimited
// JSON-RPC 2.0). Lets any MCP-capable AI (Claude Desktop, Cursor…) find real people.
// Set FINDME_API to your deployed URL (defaults to http://localhost:3000).
const API = process.env.FINDME_API || 'http://localhost:3000';

const TOOLS = [
  {
    name: 'find_people',
    description: 'Find real, consented, verified people for any intent (hire, freelance, cofounder, advisor, expert call, invest). Returns ranked candidates with evidence and match reasons.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural-language description of who you need' },
        count: { type: 'integer', description: 'How many candidates (default 6)' }
      },
      required: ['query']
    }
  },
  {
    name: 'get_profile',
    description: "Get a person's full verified profile (work history, education, portfolio, proof) by id.",
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Person id from find_people' }
      },
      required: ['id']
    }
  },
  {
    name: 'send_invite',
    description: 'Invite a person to start a relationship for an intent (hire/freelance/cofounder/advisor/expert_call/invest).',
    inputSchema: {
      type: 'object',
      properties: {
        personId: { type: 'string' },
        fromName: { type: 'string' },
        intent: { type: 'string' },
        message: { type: 'string' }
      },
      required: ['personId', 'fromName']
    }
  }
];

async function callTool(name, a = {}) {
  if (name === 'find_people')
    return (await fetch(API + '/api/find', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: a.query, count: a.count })
    })).json();
  if (name === 'get_profile')
    return (await fetch(API + '/api/person/' + encodeURIComponent(a.id))).json();
  if (name === 'send_invite')
    return (await fetch(API + '/api/invite', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(a)
    })).json();
  throw new Error('unknown tool: ' + name);
}

const send = (m) => process.stdout.write(JSON.stringify(m) + '\n');
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (line) handle(line);
  }
});

async function handle(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  const { id, method, params } = msg;
  if (method === 'initialize') {
    return send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: (params && params.protocolVersion) || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'findme', version: '1.0.0' }
      }
    });
  }
  if (method === 'notifications/initialized' || method === 'initialized') return;
  if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
  if (method === 'tools/list')
    return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
  if (method === 'tools/call') {
    const name = params && params.name;
    const args = (params && params.arguments) || {};
    try {
      const data = await callTool(name, args);
      return send({
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
      });
    } catch (e) {
      return send({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: 'Error: ' + String((e && e.message) || e) }],
          isError: true
        }
      });
    }
  }
  if (id !== undefined)
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found: ' + method } });
}

process.stderr.write('FindMe MCP server (zero-dep) running, API=' + API + '\n');
