# FindMe MCP server (zero-dependency)

Let any MCP-capable AI (Claude Desktop, Cursor, Windsurf…) find real people through FindMe.
No `npm install` needed — just Node 18+.

## Add to Claude Desktop

Edit `claude_desktop_config.json`
(macOS: `~/Library/Application Support/Claude/`, Windows: `%APPDATA%\Claude\`):

```json
{
  "mcpServers": {
    "findme": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/human-api/mcp-server/index.mjs"],
      "env": { "FINDME_API": "https://YOUR-human-api-url.vercel.app" }
    }
  }
}
```

Restart Claude Desktop, then ask: **"Find me 10 of the best B2B salespeople near Shanghai, then invite the top one."**
Claude will call `find_people` → `get_profile` → `send_invite`.

## Tools

- `find_people(query, count)` — ranked candidates with evidence + reasons
- `get_profile(id)` — full verified profile
- `send_invite(personId, fromName, intent?, message?)` — start a relationship

`FINDME_API` defaults to `http://localhost:3000` for local testing.
