# SA Recruiters — GitHub deployment package

This ZIP contains the changed static-app files from the compatibility-hardening pass. Copy the files at the ZIP root into the root of the existing SA Recruiters GitHub repository, replacing the matching files. Keep the existing images, icons, `content.js`, `content-manager.js`, `.github/workflows/deploy.yml`, SQL files, and any other unchanged repository files.

The `maintenance/` folder contains the compatibility test, audit notes, and project checklist. It is not required by the GitHub Pages runtime.

The static generator should be run by the existing workflow from the repository root. It now prevents an empty/partial Supabase result from overwriting the site and ensures duplicate vacancy routes do not overwrite each other. The generator still uses the existing public Supabase URL/anon key configuration.

Before pushing, review the generated `agency/`, `vacancy/`, `jobs/`, `sitemap.xml`, and `static-pages.css` outputs according to the repository’s existing workflow. Do not commit `node_modules/` or a local `dist/` directory.

WhatsApp publishing is not included in this package because no provider credentials were configured.
