# Supabase performance pass

## Applied changes

The public app and admin console already load independent startup requests concurrently. This pass reduces response payloads by replacing startup `select('*')` queries with explicit projections containing only fields used by the directory cards, filters, editors, dashboard, and review screens.

The public app continues to paint from its local cache immediately, then refreshes agencies, branches, vacancies, employers, and public settings in parallel. Talent Pool candidates and Track of the Day remain deferred until their sections are opened or immediately after the first paint, respectively.

The admin console continues to load independent dashboard datasets concurrently after authentication, but now transfers only the fields needed by its tables, editors, review screens, and track manager.

## Database setup

Run `CREATE_PERFORMANCE_INDEXES.sql` once in the Supabase SQL Editor. The migration is idempotent and adds indexes for directory relationships, status filters, common vacancy filters, verified-name ordering, and Track of the Day date ordering.

## Deployment

Deploy the complete archive, then hard-refresh the public app and admin console. Existing local cache data remains compatible. The service worker version is bumped so browsers request the updated scripts.

## Measurement note

The code-level pass reduces payload size and avoids unnecessary columns, but exact latency depends on Supabase region, network conditions, row counts, and database plan selection. After running the index migration, compare the Supabase dashboard query timings and browser Network panel before and after deployment.
