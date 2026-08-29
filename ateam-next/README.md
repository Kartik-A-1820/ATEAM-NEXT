# Ateam Next

Next-generation Ateam scratch project.

## Run

```powershell
npm install
npm run dev
```

Equivalent direct command:

```powershell
npx tsx src/cli.tsx dev --simulate
```

Useful scenarios:

```powershell
npx tsx src/cli.tsx run "Refactor auth" --simulate --json
npx tsx src/cli.tsx sessions
npx tsx src/cli.tsx resume
npx tsx src/cli.tsx doctor
npx tsx src/cli.tsx dev --simulate --scenario TOOL_HEAVY
npx tsx src/cli.tsx dev --simulate --scenario RATE_LIMIT
npx tsx src/cli.tsx dev --simulate --scenario PERMISSION_REQUEST
npx tsx src/cli.tsx dev --simulate --scenario CRASH
```

## Check

```powershell
npm run build
npm run lint
npm test
```
