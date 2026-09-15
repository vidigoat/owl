# Architecture

`TODO` — expand as tools land.

```
Alexa+ (or the simulated device) ──► MCP server (Streamable HTTP, 2025-11-25)
                                        ├── vision tools    → Bedrock
                                        ├── diagnose        → data/ service data
                                        ├── verify_diagnosis→ THE GATE
                                        ├── guide           → MCP Apps step cards
                                        ├── find/order part → Amazon Wallet
                                        └── home.*          → AgentCore Memory
```

## The gate
`verify_diagnosis` is the only function allowed to authorise spending. `TODO` — document the thresholds,
the abstain conditions, and why mains-voltage causes always escalate to a technician.

## Service data
`data/` is keyed by model. `TODO` — document the schema and where each fault code came from.
