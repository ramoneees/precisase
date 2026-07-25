-- Add isActive column to categories (default true — existing categories stay active)
ALTER TABLE categories ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT true;

-- Seed the jobs category (inactive by default — admin enables via feature flag page)
INSERT INTO categories (id, slug, key, is_active)
VALUES (gen_random_uuid(), 'jobs', 'category.jobs', false)
ON CONFLICT (slug) DO UPDATE SET key = EXCLUDED.key, is_active = false;