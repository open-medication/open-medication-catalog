# Website

Static landing page for [openmedicationcatalog.org](https://openmedicationcatalog.org).

```bash
pnpm install
pnpm dev
```

`public/catalog.json` is the machine index also served at `/catalog.json`. The monthly release workflow regenerates it from GitHub Releases before publishing the Astro build to GitHub Pages.
