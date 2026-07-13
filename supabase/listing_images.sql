-- Optional photo on user-submitted listings. Events already have image_url;
-- food_trucks needs it. User photos upload to the existing public 'sale-photos'
-- bucket (same as garage sales), so no new bucket/policy. Safe to re-run.
alter table public.food_trucks add column if not exists image_url text;
alter table public.events add column if not exists image_url text;
