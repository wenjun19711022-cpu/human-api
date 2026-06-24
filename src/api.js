'use strict';
// Human API - Core API handler
// This is a stub implementation. Extend with your actual logic.

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const method = req.method;

  // Handle CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (method === 'OPTIONS') {
    res.writeHead(200);
    return res.end();
  }

  // Route handlers
  if (pathname === '/api/find' && method === 'POST') {
    return handleFind(req, res);
  }
  if (pathname.startsWith('/api/person/') && method === 'GET') {
    return handleGetProfile(req, res);
  }
  if (pathname === '/api/invite' && method === 'POST') {
    return handleInvite(req, res);
  }
  if (pathname === '/api/mcp' && method === 'GET') {
    return handleMcp(req, res);
  }

  return false; // Not handled
}

async function handleFind(req, res) {
  const body = await readBody(req);
  try {
    const { query, count } = JSON.parse(body);
    // Placeholder response
    const response = {
      query,
      count: count || 6,
      candidates: [
        {
          id: '1',
          name: 'Sample Candidate',
          headline: 'Sales Professional',
          match: 95,
          reasons: ['10+ years in B2B sales', 'SaaS experience', 'Located nearby']
        }
      ]
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid request' }));
  }
}

async function handleGetProfile(req, res) {
  const personId = decodeURIComponent(req.url.split('/').pop());
  // Placeholder response
  const response = {
    id: personId,
    name: 'Sample Person',
    headline: 'Professional',
    bio: 'Sample bio',
    workHistory: [],
    education: [],
    portfolio: []
  };
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(response));
}

async function handleInvite(req, res) {
  const body = await readBody(req);
  try {
    const data = JSON.parse(body);
    // Placeholder response
    const response = { success: true, message: 'Invite sent' };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid request' }));
  }
}

async function handleMcp(req, res) {
  const response = {
    tools: [
      {
        name: 'find_people',
        description: 'Find real, consented, verified people for any intent'
      },
      {
        name: 'get_profile',
        description: "Get a person's full verified profile"
      },
      {
        name: 'send_invite',
        description: 'Invite a person to start a relationship'
      }
    ]
  };
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(response));
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk.toString()));
    req.on('end', () => resolve(body));
  });
}

module.exports = { handleApi };
