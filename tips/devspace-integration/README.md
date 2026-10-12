# Integrated in the standalone repository

The deployable DevSpace + Tips MCP project now contains the **full DevSpace
runtime distribution**, not just integration patch files:

`../../vendor/devspace/dist/`

That directory already includes the MCP hooks, Tips HTTP routes, UI and
`subagent` tool registration. There is nothing to manually patch into a
separately installed global DevSpace package.

Start from the repository root: `npm install && npm run setup -- ... && npm start`.
For persistent operation run `npm run install:user-service`, which generates
a host-specific unit with the correct absolute paths. Do not copy old
machine-specific service units from production.
