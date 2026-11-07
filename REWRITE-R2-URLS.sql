-- One-off: point stored photo/CV/poster URLs at the custom domain.
-- RUN ONLY AFTER the worker with R2_LEGACY_BASE_URL support is deployed
-- (paid CV downloads and poster deletes match URLs by origin).
-- Run against D1 `sarecruiters-d1`; then run the Supabase equivalent if the same
-- columns are the source of truth there (see SUPABASE-CLOUDFLARE-D1-ARCHITECTURE.md).
UPDATE agencies           SET photo         = REPLACE(photo,         'https://pub-911e4cd402674c6f85c747b12212772f.r2.dev', 'https://media.sa-recruiters.co.za') WHERE photo         LIKE 'https://pub-911e4cd402674c6f85c747b12212772f.r2.dev/%';
UPDATE employers          SET photo         = REPLACE(photo,         'https://pub-911e4cd402674c6f85c747b12212772f.r2.dev', 'https://media.sa-recruiters.co.za') WHERE photo         LIKE 'https://pub-911e4cd402674c6f85c747b12212772f.r2.dev/%';
UPDATE vacancies          SET company_photo = REPLACE(company_photo, 'https://pub-911e4cd402674c6f85c747b12212772f.r2.dev', 'https://media.sa-recruiters.co.za') WHERE company_photo LIKE 'https://pub-911e4cd402674c6f85c747b12212772f.r2.dev/%';
UPDATE pool_candidates    SET photo_url     = REPLACE(photo_url,     'https://pub-911e4cd402674c6f85c747b12212772f.r2.dev', 'https://media.sa-recruiters.co.za') WHERE photo_url     LIKE 'https://pub-911e4cd402674c6f85c747b12212772f.r2.dev/%';
UPDATE employer_posters   SET image_url     = REPLACE(image_url,     'https://pub-911e4cd402674c6f85c747b12212772f.r2.dev', 'https://media.sa-recruiters.co.za') WHERE image_url     LIKE 'https://pub-911e4cd402674c6f85c747b12212772f.r2.dev/%';
UPDATE cv_download_orders SET cv_url        = REPLACE(cv_url,        'https://pub-911e4cd402674c6f85c747b12212772f.r2.dev', 'https://media.sa-recruiters.co.za') WHERE cv_url        LIKE 'https://pub-911e4cd402674c6f85c747b12212772f.r2.dev/%';
