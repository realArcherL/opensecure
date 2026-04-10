# Opensecure

Visualize the blast radius of npm supply chain attacks across the top 10,000 packages.

## What it does

Most npm packages don't pin exact versions. They use ranges like `^1.13.5`, so a fresh `npm install` quietly pulls the latest match, even if it's compromised.

This tool seeds the top 10,000 npm packages (by downloads and dependents), fetches their dependency graphs from [deps.dev](https://deps.dev), and builds a force graph showing what happens if any one of them gets taken over.

Pick a package and you'll see:

- how many other top-10,000 packages it would reach
- how many of those would auto-pull a bad version (`^`, `~`, `>=`)
- how many are pinned or need a manual update
- how deep the chain goes

## Commands

```bash
npm run build       # compile TS
npm run seed        # top 10,000 packages -> data/top.json
npm run fetch       # fetch from deps.dev -> data/raw/*.json
npm run graph       # build graph -> data/graph.json
npm run viz         # serve at localhost:3000
```

Run in order: `build > seed > fetch > graph > viz`

## References

- [The Hidden Blast Radius of the Axios Compromise](https://socket.dev/blog/hidden-blast-radius-of-the-axios-compromise) - Socket

## License

MIT
