-- Stop the aggregator from spamming the moderation queue + alerts. Events/trucks from
-- trusted feeds (Ticketmaster/SeatGeek/library + calendar feeds) carry a source_uid and
-- are pre-vetted, but the user-submission moderator was flagging them 'pending' whenever
-- a description held a registration link — which then fired a moderation_alert (email +
-- push) per row on every ingest, and hid legit events from the app.
--
-- Fix: auto-approve rows that carry a source_uid (events + food_trucks only; garage_sales
-- has no such column, so guard by table). User submissions (source_uid null) still run
-- through the full moderator. Then clear the current backlog of aggregator 'pending' rows.
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

  -- Aggregator/trusted-source rows carry a source_uid; auto-approve so their event
  -- registration links don't trip the user-spam filter (false 'pending') and fire a
  -- moderation alert on every ingest.
  if TG_TABLE_NAME in ('events', 'food_trucks') then
    if NEW.source_uid is not null then
      NEW.status := 'approved';
      return NEW;
    end if;
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

-- Clear the backlog: approve the aggregator rows already stuck pending (source_uid set).
update public.events      set status = 'approved' where status = 'pending' and source_uid is not null;
update public.food_trucks set status = 'approved' where status = 'pending' and source_uid is not null;
