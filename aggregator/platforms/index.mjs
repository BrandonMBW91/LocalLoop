// Platform connector registry. Each connector handles one calendar PLATFORM
// (not one venue): given an event_sources row ({url: host/calendar URL, city_id:
// fallback town}), it returns RAW events which aggregate.mjs pushes through the
// same quality gauntlet as iCal (junk filters, town routing, dedup hashing).
//
// Adding a city on any of these platforms is therefore just an event_sources row:
//   insert into event_sources (city_id, name, type, url) values
//     ('marion', 'Marion Public Library', 'communico', 'https://marionpubliclibrary.libnet.info');
//
// Raw event shape every connector returns:
//   { summary, description, location, url, image, start: Date, end: Date|null, allDay?: bool }
import * as librarymarket from './librarymarket.mjs';
import * as bibliocommons from './bibliocommons.mjs';
import * as communico from './communico.mjs';
import * as simpleview from './simpleview.mjs';
import * as baselocal from './baselocal.mjs';
import * as explorelc from './explorelc.mjs';

export const PLATFORMS = {
  librarymarket,
  bibliocommons,
  communico,
  simpleview,
  baselocal,
  explorelc,
};
