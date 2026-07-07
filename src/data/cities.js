// Supported cities. Findlay is the launch market. `region` groups towns in the
// picker; REGION_ORDER controls the section order.

export const REGION_ORDER = ['Northwest Ohio', 'Central Ohio', 'Northeast Ohio'];
const NW = 'Northwest Ohio';
const CENTRAL = 'Central Ohio';
const NE = 'Northeast Ohio';

export const CITIES = [
  // --- Northwest Ohio ---
  { id: 'findlay', name: 'Findlay', state: 'OH', region: NW, tagline: 'Flag City, USA' },
  { id: 'fostoria', name: 'Fostoria', state: 'OH', region: NW, tagline: 'City of Industry' },
  { id: 'tiffin', name: 'Tiffin', state: 'OH', region: NW, tagline: 'The Heart of Seneca County' },
  { id: 'bowling-green', name: 'Bowling Green', state: 'OH', region: NW, tagline: 'Home of BGSU' },
  { id: 'sandusky', name: 'Sandusky', state: 'OH', region: NW, tagline: 'On the shores of Lake Erie' },
  { id: 'lima', name: 'Lima', state: 'OH', region: NW, tagline: 'Heart of the Region' },
  { id: 'van-wert', name: 'Van Wert', state: 'OH', region: NW, tagline: 'Peony Capital of Ohio' },
  { id: 'toledo', name: 'Toledo', state: 'OH', region: NW, tagline: 'The Glass City' },
  { id: 'perrysburg', name: 'Perrysburg', state: 'OH', region: NW, tagline: 'Historic riverfront town' },
  { id: 'bluffton', name: 'Bluffton', state: 'OH', region: NW, tagline: 'Home of Bluffton University' },
  { id: 'ada', name: 'Ada', state: 'OH', region: NW, tagline: 'Home of Ohio Northern' },
  { id: 'waterville', name: 'Waterville', state: 'OH', region: NW, tagline: 'Along the Maumee River' },
  { id: 'north-baltimore', name: 'North Baltimore', state: 'OH', region: NW, tagline: 'Crossroads of the Heartland' },
  { id: 'carey', name: 'Carey', state: 'OH', region: NW, tagline: 'Home of the Basilica' },
  { id: 'leipsic', name: 'Leipsic', state: 'OH', region: NW, tagline: 'Named for Leipzig, Germany' },
  { id: 'arlington', name: 'Arlington', state: 'OH', region: NW, tagline: 'Flag Village, USA' },
  { id: 'pandora', name: 'Pandora', state: 'OH', region: NW, tagline: 'Swiss Mennonite Heritage' },
  { id: 'upper-sandusky', name: 'Upper Sandusky', state: 'OH', region: NW, tagline: 'Wyandot County Seat' },
  // --- Central / West-Central Ohio ---
  { id: 'bellefontaine', name: 'Bellefontaine', state: 'OH', region: CENTRAL, tagline: "Ohio's Highest Point" },
  { id: 'kenton', name: 'Kenton', state: 'OH', region: CENTRAL, tagline: 'Cast-Iron Toy Capital' },
  { id: 'richwood', name: 'Richwood', state: 'OH', region: CENTRAL, tagline: 'Home of the Independent Fair' },
  { id: 'larue', name: 'LaRue', state: 'OH', region: CENTRAL, tagline: 'Smallest NFL Town Ever' },
  { id: 'prospect', name: 'Prospect', state: 'OH', region: CENTRAL, tagline: 'On the Scioto River' },
  { id: 'green-camp', name: 'Green Camp', state: 'OH', region: CENTRAL, tagline: 'War of 1812 Camp Town' },
  // --- Northeast Ohio (Akron & Canton metros) ---
  // All carry live content from the local-feed aggregator (libraries, city
  // calendars, universities, parks, downtowns) plus Ticketmaster.
  { id: 'akron', name: 'Akron', state: 'OH', region: NE, tagline: 'The Rubber City' },
  { id: 'cuyahoga-falls', name: 'Cuyahoga Falls', state: 'OH', region: NE, tagline: 'On the Cuyahoga River' },
  { id: 'kent', name: 'Kent', state: 'OH', region: NE, tagline: 'Home of Kent State' },
  { id: 'stow', name: 'Stow', state: 'OH', region: NE, tagline: 'Home of Silver Springs' },
  { id: 'hudson', name: 'Hudson', state: 'OH', region: NE, tagline: 'Historic village green' },
  { id: 'tallmadge', name: 'Tallmadge', state: 'OH', region: NE, tagline: 'The Circle City' },
  { id: 'barberton', name: 'Barberton', state: 'OH', region: NE, tagline: 'The Magic City' },
  { id: 'wadsworth', name: 'Wadsworth', state: 'OH', region: NE, tagline: 'The Grizzly City' },
  { id: 'canton', name: 'Canton', state: 'OH', region: NE, tagline: 'Home of the Pro Football Hall of Fame' },
  { id: 'massillon', name: 'Massillon', state: 'OH', region: NE, tagline: 'Tiger Town' },
  { id: 'north-canton', name: 'North Canton', state: 'OH', region: NE, tagline: 'The Hoover City' },
  { id: 'hartville', name: 'Hartville', state: 'OH', region: NE, tagline: 'Home of the MarketPlace' },
  { id: 'alliance', name: 'Alliance', state: 'OH', region: NE, tagline: 'The Carnation City' },
];
