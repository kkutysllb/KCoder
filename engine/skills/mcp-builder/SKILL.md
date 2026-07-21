---
id: mcp-builder
name: MCP Builder
---
# MCP Builder Skill

Guide for creating high-quality MCP (Model Context Protocol) servers that enable LLMs to interact with external services through well-designed tools.

## Choosing a Stack

- **TypeScript + @modelcontextprotocol/sdk** — best for Node.js services, npm ecosystem
- **Python + FastMCP** — best for Python services, data pipelines, ML APIs

## TypeScript Template

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const server = new McpServer({ name: 'my-service', version: '1.0.0' })

server.tool(
  'get_weather',
  'Get current weather for a city',
  { city: z.string().describe('City name, e.g. "Beijing"') },
  async ({ city }) => {
    const res = await fetch(`https://api.example.com/weather?city=${city}`)
    if (!res.ok) return { content: [{ type: 'text', text: `Error: ${res.status}` }], isError: true }
    const data = await res.json()
    return { content: [{ type: 'text', text: JSON.stringify(data) }] }
  }
)

const transport = new StdioServerTransport()
await server.connect(transport)
```

## Tool Design Principles

1. **Names**: verb_noun, snake_case, self-explanatory (`search_issues`, `create_document`)
2. **Descriptions**: one sentence stating what + when to use; the LLM relies on this for selection
3. **Parameters**: use Zod/Pydantic schemas with `.describe()` on every field
4. **Errors**: return `isError: true` with actionable message, never throw unhandled
5. **Output**: concise structured text; truncate large payloads (<10KB ideal)

## Quality Checklist

- [ ] Every tool has a clear, non-overlapping responsibility
- [ ] Input validation with helpful error messages
- [ ] API keys read from environment variables, never hardcoded
- [ ] Tested with MCP Inspector: `npx @modelcontextprotocol/inspector`
- [ ] README documents: tools, env vars, transport setup

## Client Configuration

```json
{
  "mcpServers": {
    "my-service": {
      "command": "node",
      "args": ["path/to/server.js"],
      "env": { "API_KEY": "..." }
    }
  }
}
```
