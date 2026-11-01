# Workspace colors

Checks the real color classification prompt through Codex structured generation. Covers review intent, project rules, an explicit priority, no match, a custom fallback, and an instruction embedded in the first prompt.

Run with a cheap model and explicit Codex account paths:

```sh
node workspace-colors/run.ts --model <model> --home <Codex home> --shadow <shadow home> --out runs/colors.json
```

The runner uses low reasoning effort and six short requests. Results record the expected and actual color for each case. All cases must pass. The runtime schema also rejects colors outside the configured rules and the fallback color. Use `--case custom-fallback` to run only the custom fallback case.
