-- Server-side length caps on user submissions (pre-deploy review, medium). The
-- event/garage-sale/food-truck text columns are unbounded, so a submitter could store
-- an absurdly large string. Clamp inside the existing moderate_submission BEFORE-INSERT
-- trigger (non-admins only; admin publishes as-is). Identical to moderation.sql's
-- function otherwise — only the left(...) clamps are added. left(NULL,n)=NULL, and
-- legit content is far under these caps, so this is inert for normal submissions.
create or replace function public.moderate_submission()
returns trigger
language plpgsql
as $$
declare content text;
begin
  -- Trusted moderators (you) publish instantly, no holding.
  if public.is_admin() then
    NEW.status := 'approved';
    return NEW;
  end if;

  if TG_TABLE_NAME = 'events' then
    NEW.title := left(NEW.title, 200);
    NEW.description := left(NEW.description, 5000);
    NEW.venue := left(NEW.venue, 200);
    NEW.address := left(NEW.address, 300);
    NEW.host := left(NEW.host, 120);
    content := lower(concat_ws(' ', NEW.title, NEW.description, NEW.venue, NEW.address));
  elsif TG_TABLE_NAME = 'garage_sales' then
    NEW.title := left(NEW.title, 200);
    NEW.note := left(NEW.note, 5000);
    NEW.address := left(NEW.address, 300);
    NEW.neighborhood := left(NEW.neighborhood, 120);
    content := lower(concat_ws(' ', NEW.title, NEW.note, NEW.address));
  elsif TG_TABLE_NAME = 'food_trucks' then
    NEW.name := left(NEW.name, 200);
    NEW.note := left(NEW.note, 5000);
    NEW.location_name := left(NEW.location_name, 200);
    NEW.address := left(NEW.address, 300);
    NEW.cuisine := left(NEW.cuisine, 80);
    content := lower(concat_ws(' ', NEW.name, NEW.note, NEW.location_name, NEW.address));
  else
    content := '';
  end if;

  -- Hold for human review if anything looks risky; otherwise auto-approve.
  if content ~* '(https?://|www\.|[a-z0-9-]+\.(com|net|org|info|biz|xyz|shop|io))'   -- web links
     or content ~ '(\+?\d[ .\-]?){10,}'                                              -- phone numbers
     or content ~* '\m(fuck|shit|bitch|asshole|cunt|nigger|faggot|slut|whore|retard)\M'  -- profanity
     or content ~* '(make money|free money|work from home|crypto|bitcoin|viagra|casino|click here|get rich|buy now|limited offer)' -- spam
  then
    NEW.status := 'pending';
  else
    NEW.status := 'approved';
  end if;

  return NEW;
end;
$$;
