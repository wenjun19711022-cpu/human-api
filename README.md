# Human API — The AI Talent Protocol

**Evolution: Email ➡️ Phone ➡️ AI Search**

Instantly query, discover, and hire the exact people or services you need directly inside LLMs.

The open-source human capability API & AI alternative to all social media.

## What is Human API?

Human API is a protocol and service that lets AI agents (ChatGPT, Claude, Gemini, etc.) find, verify, and connect with real people for any intent:

- **Hire** talented professionals
- **Find freelancers** for projects
- **Discover co-founders** for startups
- **Connect with advisors** and mentors
- **Book expert calls** and consultations
- **Raise capital** from investors

## Features

✨ **Zero dependencies** — Pure Node.js  
🔍 **Natural language search** — "Find me 10 B2B salespeople near Shanghai"  
✅ **Verified & consented** — Only real people who opted in  
🤖 **AI-native** — MCP protocol for Claude, Cursor, Windsurf  
🌐 **Web + API** — Frontend UI and REST API  
🚀 **Deployable** — Works on Vercel, Node.js servers  

## Quick Start

### Local Development

```bash
# Clone this repo
git clone https://github.com/wenjun19711022-cpu/human-api.git
cd human-api

# Install dependencies (Node 18+)
node --version  # Must be >=18

# Run the server
npm start
# or
node server.js
```

Server runs on `http://localhost:3000`

### Deploy to Vercel

```bash
npm install -g vercel
vercel
```

Then set environment variable:
```
FINDME_API=https://your-vercel-url.vercel.app
```

## API Endpoints

### `POST /api/find`

Find people by natural language query.

```bash
curl -X POST http://localhost:3000/api/find \
  -H 'Content-Type: application/json' \
  -d '{"query": "Find me 5 B2B SaaS sales leaders", "count": 5}'
```

Response:
```json
{
  "candidates": [
    {
      "id": "person-123",
      "name": "Jane Smith",
      "headline": "VP Sales, SaaS",
      "match": 94,
      "reasons": ["10+ years B2B SaaS", "$10M+ ARR closed"],
      "status": "online"
    }
  ]
}
```

### `GET /api/person/:id`

Get full profile for a person.

```bash
curl http://localhost:3000/api/person/person-123
```

Response:
```json
{
  "id": "person-123",
  "name": "Jane Smith",
  "headline": "VP Sales, SaaS",
  "bio": "...",
  "workHistory": [...],
  "education": [...],
  "portfolio": [...]
}
```

### `POST /api/invite`

Send an invite to connect.

```bash
curl -X POST http://localhost:3000/api/invite \
  -H 'Content-Type: application/json' \
  -d '{
    "personId": "person-123",
    "fromName": "Your Company",
    "intent": "hire",
    "message": "We'd love to chat about a VP Sales role..."
  }'
```

### `GET /api/mcp`

Get MCP tool definitions (for AI agents).

## MCP Server (For Claude, Cursor, Windsurf)

The MCP (Model Context Protocol) server lets any MCP-capable AI call Human API.

### Add to Claude Desktop

Edit `claude_desktop_config.json`:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "human-api": {
      "command": "node",
      "args": ["/path/to/human-api/mcp-server/index.mjs"],
      "env": {
        "FINDME_API": "https://your-deployed-url.vercel.app"
      }
    }
  }
}
```

Restart Claude Desktop, then:

> Find me 10 of the best B2B SaaS sales leaders in California, then invite the top 3.

Claude will automatically call `find_people` → `get_profile` → `send_invite`.

## Architecture

```
human-api/
├── server.js              # Main HTTP server (zero-dep)
├── public/
│   ├── index.html         # Web UI
│   ├── styles.css
│   └── app.js             # Frontend logic
├── src/
│   └── api.js             # API handlers
├── api/
│   └── index.js           # Vercel serverless function
├── mcp-server/
│   └── index.mjs          # MCP server for AI agents
└── vercel.json            # Vercel config
```

## Environment Variables

```bash
PORT=3000                    # Server port (default 3000)
FINDME_API=http://localhost:3000  # For MCP client
```

## License

MIT — Free to use, modify, and deploy.

## Community

Contributions welcome! Open issues and PRs.

---

**Made with ❤️ for the AI agent era**
