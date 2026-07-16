-- Stop the aggregator from spamming the moderation queue + alerts. Events/trucks from
-- trusted feeds (Ticketmaster/SeatGeek/library + calendar feeds) carry a source_uid and
-- are pre-vetted, but the user-submission moderator was flagging them 'pending' whenever
-- a description held a registration link — which then fired a moderation_alert (email +
-- push) per row on every ingest, and hid legit events from the app.
--
-- Fix: auto-approve rows that carry a source_uid (events + food_trucks only; garage_sales
-- has no such column, so guard by table). User submissions (source_uid null) still run
-- through the full moderator. Then clear the current backlog of aggregator 'pending' rows.
-- moderate_submission() previously had a copy here that added the trusted-source
-- auto-approve branch (rows carrying a source_uid on events/food_trucks skip the
-- user-spam filter), on top of the admin branch and the field length caps.
-- REMOVED 2026-07-16: it was one of seven competing definitions, and re-running this
-- file would have reverted newer fixes in production.
-- The authoritative definition now lives in supabase/moderate_submission.sql.
-- Its history section records what this file contributed.

-- Clear the backlog: approve the aggregator rows already stuck pending (source_uid set).
update public.events      set status = 'approved' where status = 'pending' and source_uid is not null;
update public.food_trucks set status = 'approved' where status = 'pending' and source_uid is not null;
