# Extension Side — Dependency Graph

```
extension.js
  └── lib/handlers.js
        ├── lib/storage.js
        │     └── lib/normalize.js
        ├── lib/terminal.js
        ├── lib/auto-variables.js
        ├── lib/ids.js
        ├── lib/ai/languages.js
        └── lib/ai/factory.js
              ├── lib/ai/providers-config.js
              ├── lib/ai/providers/*.js
              │     └── lib/ai/structured-output.js
              ├── lib/ai/systemInstruction.js
              │     └── lib/ai/schemas.js
              └── lib/ai/generation.js
                    ├── lib/ai/schemas.js
                    ├── lib/ai/systemInstruction.js
                    ├── lib/ai/structured-output.js
                    ├── lib/ids.js
                    └── lib/normalize.js
```
