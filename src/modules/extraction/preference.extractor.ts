import { UserPreferences } from '../../shared/types/session.types';

const LAKH = 100_000;
const CRORE = 10_000_000;

function parseIndianAmount(value: string, unit: string): number {
  const num = parseFloat(value.replace(/,/g, ''));
  const u = unit.toLowerCase();
  if (u.startsWith('cr')) return Math.round(num * CRORE);
  if (u.startsWith('l')) return Math.round(num * LAKH);
  return Math.round(num);
}

const KNOWN_LOCALITIES: string[] = [
  // Western suburbs
  'Andheri', 'Bandra', 'Juhu', 'Versova', 'Santacruz', 'Khar', 'Vile Parle',
  'Goregaon', 'Malad', 'Kandivali', 'Borivali', 'Dahisar',
  // Eastern suburbs
  'Kurla', 'Ghatkopar', 'Vikhroli', 'Powai', 'Chembur', 'Govandi', 'Mulund',
  'Bhandup', 'Nahur', 'Kanjurmarg',
  // Central / South
  'Dadar', 'Parel', 'Worli', 'Lower Parel', 'Matunga', 'Sion', 'Wadala',
  'Mahim', 'Dharavi', 'Chunabhatti',
  // South Mumbai
  'Colaba', 'Cuffe Parade', 'Nariman Point', 'Fort', 'Marine Lines',
  'Malabar Hill', 'Walkeshwar', 'Breach Candy', 'Kemp\'s Corner',
  // Thane / Navi Mumbai
  'Thane', 'Navi Mumbai', 'Vashi', 'Kharghar', 'Panvel', 'Nerul',
  'Belapur', 'Airoli', 'Ghansoli', 'Turbhe', 'Rabale', 'Kopar Khairane',
  // Misc
  'Mira Road', 'Bhayander', 'Vasai', 'Nalasopara', 'Virar', 'Vasai Road',
  'Dombivli', 'Kalyan', 'Ambernath', 'Badlapur',
];

const LOCALITY_LOWER = KNOWN_LOCALITIES.map(l => l.toLowerCase());

const PROPERTY_TYPE_MAP: Record<string, UserPreferences['propertyType']> = {
  'flat': 'APARTMENT',
  'apartment': 'APARTMENT',
  'bhk': 'APARTMENT',
  'villa': 'VILLA',
  'bungalow': 'VILLA',
  'house': 'VILLA',
  'independent house': 'VILLA',
  'plot': 'PLOT',
  'land': 'PLOT',
  'office': 'OFFICE',
  'shop': 'SHOP',
  'commercial': 'COMMERCIAL',
};

const FURNISHED_MAP: Record<string, string> = {
  'fully furnished': 'Furnished',
  'fully-furnished': 'Furnished',
  'semi furnished': 'Semi-Furnished',
  'semi-furnished': 'Semi-Furnished',
  'unfurnished': 'Unfurnished',
  'bare shell': 'Unfurnished',
};

export function extractPreferences(message: string): Partial<UserPreferences> {
  const msg = message.toLowerCase().trim();
  const extracted: Partial<UserPreferences> = {};

  // 1. Budget
  const rangeMatch = msg.match(
    /(?:between\s+)?(\d+(?:\.\d+)?)\s*(?:to|-|and)\s*(\d+(?:\.\d+)?)\s*(lakh|lakhs|lac|l|crore|crores|cr)/i
  );
  if (rangeMatch) {
    extracted.budgetMin = parseIndianAmount(rangeMatch[1]!, rangeMatch[3]!);
    extracted.budgetMax = parseIndianAmount(rangeMatch[2]!, rangeMatch[3]!);
  } else {
    const maxMatch = msg.match(
      /(?:under|below|max|maximum|upto|up to|within|budget\s+of?)\s*(\d+(?:\.\d+)?)\s*(lakh|lakhs|lac|l|crore|crores|cr)/i
    );
    if (maxMatch) {
      extracted.budgetMax = parseIndianAmount(maxMatch[1]!, maxMatch[2]!);
    }

    const minMatch = msg.match(
      /(?:atleast|at least|minimum|min|starting from|above|more than)\s*(\d+(?:\.\d+)?)\s*(lakh|lakhs|lac|l|crore|crores|cr)/i
    );
    if (minMatch) {
      extracted.budgetMin = parseIndianAmount(minMatch[1]!, minMatch[2]!);
    }

    const aroundMatch = msg.match(
      /(?:around|approximately|about|~)\s*(\d+(?:\.\d+)?)\s*(lakh|lakhs|lac|l|crore|crores|cr)/i
    );
    if (aroundMatch && !extracted.budgetMin && !extracted.budgetMax) {
      const amount = parseIndianAmount(aroundMatch[1]!, aroundMatch[2]!);
      extracted.budgetMin = Math.round(amount * 0.85);
      extracted.budgetMax = Math.round(amount * 1.15);
    }
  }

  // 2. Bedrooms
  const bedroomMatch = msg.match(/(\d)\s*(?:bhk|bed|bedroom|bedrooms|br|-bed)/i);
  if (bedroomMatch) {
    extracted.bedroomsMin = parseInt(bedroomMatch[1]!);
    extracted.bedroomsMax = parseInt(bedroomMatch[1]!);
  } else if (/\bstudio\b/.test(msg) || /\b1\s*rk\b/i.test(msg)) {
    extracted.bedroomsMin = 0;
    extracted.bedroomsMax = 0;
  }

  // 3. Property type
  for (const [keyword, type] of Object.entries(PROPERTY_TYPE_MAP)) {
    if (msg.includes(keyword)) {
      extracted.propertyType = type;
      break;
    }
  }

  // 4. Localities
  const foundLocalities: string[] = [];
  LOCALITY_LOWER.forEach((localityLower, i) => {
    if (msg.includes(localityLower)) {
      foundLocalities.push(KNOWN_LOCALITIES[i]!);
    }
  });
  if (foundLocalities.length > 0) {
    extracted.localities = foundLocalities;
  }

  // 5. Listing type
  if (/\brent\b|\brenting\b|\bon rent\b|\bfor rent\b|\blease\b/.test(msg)) {
    extracted.listingType = 'RENT';
  } else if (/\bbuy\b|\bpurchase\b|\bfor sale\b|\bsale\b|\bbuying\b/.test(msg)) {
    extracted.listingType = 'SALE';
  }

  // 6. Ready to move / Under construction
  if (/ready\s*to\s*move|ready\s*possession|immediate\s*possession/.test(msg)) {
    extracted.mustHaves = [...(extracted.mustHaves ?? []), 'ready_to_move'];
  } else if (/under\s*construction|uc\s+project|new\s*launch/.test(msg)) {
    extracted.mustHaves = [...(extracted.mustHaves ?? []), 'under_construction'];
  }

  // 7. Furnished status
  for (const [keyword, status] of Object.entries(FURNISHED_MAP)) {
    if (msg.includes(keyword)) {
      extracted.furnishedStatus = status;
      break;
    }
  }

  // 8. Lifestyle / keywords
  const lifestyleKeywords: Record<string, string> = {
    'near metro': 'near_metro',
    'metro connectivity': 'near_metro',
    'near school': 'near_school',
    'near hospital': 'near_hospital',
    'it park': 'near_it_park',
    'it hub': 'near_it_park',
    'tech park': 'near_it_park',
    'quiet': 'quiet_area',
    'peaceful': 'quiet_area',
    'gated community': 'gated_community',
    'society': 'gated_community',
    'sea view': 'sea_view',
    'sea facing': 'sea_view',
    'garden view': 'garden_view',
    'parking': 'parking',
    'car park': 'parking',
    'balcony': 'has_balcony',
    'terrace': 'has_balcony',
    'gym': 'gym',
    'clubhouse': 'clubhouse',
    'swimming pool': 'swimming_pool',
    'pool': 'swimming_pool',
    'lift': 'has_lift',
    'elevator': 'has_lift',
  };

  const lifestyle: string[] = [];
  for (const [keyword, tag] of Object.entries(lifestyleKeywords)) {
    if (msg.includes(keyword) && !lifestyle.includes(tag)) {
      lifestyle.push(tag);
    }
  }
  if (lifestyle.length > 0) {
    extracted.lifestyle = lifestyle;
  }

  return extracted;
}

export function mergePreferences(
  existing: Partial<UserPreferences>,
  newPrefs: Partial<UserPreferences>
): Partial<UserPreferences> {
  const merged = { ...existing };

  if (newPrefs.propertyType !== undefined) merged.propertyType = newPrefs.propertyType;
  if (newPrefs.bedroomsMin !== undefined)  merged.bedroomsMin  = newPrefs.bedroomsMin;
  if (newPrefs.bedroomsMax !== undefined)  merged.bedroomsMax  = newPrefs.bedroomsMax;
  if (newPrefs.budgetMin !== undefined)    merged.budgetMin    = newPrefs.budgetMin;
  if (newPrefs.budgetMax !== undefined)    merged.budgetMax    = newPrefs.budgetMax;
  if (newPrefs.furnishedStatus !== undefined) merged.furnishedStatus = newPrefs.furnishedStatus;
  if (newPrefs.listingType !== undefined)  merged.listingType  = newPrefs.listingType;

  if (newPrefs.localities?.length) {
    const set = new Set([...(existing.localities ?? []), ...newPrefs.localities]);
    merged.localities = [...set];
  }
  if (newPrefs.lifestyle?.length) {
    const set = new Set([...(existing.lifestyle ?? []), ...newPrefs.lifestyle]);
    merged.lifestyle = [...set];
  }
  if (newPrefs.mustHaves?.length) {
    const set = new Set([...(existing.mustHaves ?? []), ...newPrefs.mustHaves]);
    merged.mustHaves = [...set];
  }

  return merged;
}

export function getMissingFields(prefs: Partial<UserPreferences>): string[] {
  const missing: string[] = [];
  if (!prefs.localities?.length)                missing.push('localities');
  if (prefs.budgetMax === undefined)             missing.push('budget');
  if (prefs.bedroomsMin === undefined && prefs.propertyType !== 'PLOT') {
    missing.push('bedrooms');
  }
  return missing;
}

export function generateFollowUp(missing: string[]): string | null {
  if (missing.length === 0) return null;

  const field = missing[0]!;

  const questions: Record<string, string> = {
    localities: 'Which area or neighbourhood in Mumbai are you looking in? (e.g. Andheri, Bandra, Powai)',
    budget: 'What is your budget range? (e.g. under 80 lakhs, between 1–1.5 crores)',
    bedrooms: 'How many bedrooms do you need? (e.g. 1 BHK, 2 BHK, studio)',
  };

  return questions[field] ?? 'Could you tell me more about what you\'re looking for?';
}

export function isCommuteQuery(message: string): boolean {
  const msg = message.toLowerCase();
  const keywords = [
    // Commute, Distance & Routing
    'how far', 'commute', 'distance', 'minutes', 'travel time', 'reach',
    'far away', 'walk', 'drive', 'get to', 'commuting', 'traffic', 'journey',
    'duration', 'directions', 'route', 'map', 'traveling', 'travelling',
    'walkable', 'walking distance', 'how long', 'where is', 'how to get',

    // Proximity
    'near', 'nearby', 'nearest', 'close', 'closeby', 'around here', 'vicinity',
    'neighbourhood', 'neighborhood', 'surroundings', 'localities',

    // Transit & Roads
    'metro station', 'railway station', 'airport', 'highway', 'freeway',
    'expressway', 'link road', 'flyover', 'toll', 'bus stop', 'monorail',
    'train', 'cabs', 'rickshaw', 'auto', 'taxi', 'depot', 'terminal',

    // Education
    'school', 'college', 'university', 'coaching', 'class', 'playschool',
    'kindergarten', 'academy', 'madarsa', 'madrasa',

    // Healthcare
    'hospital', 'clinic', 'pharmacy', 'chemist', 'doctor', 'dispensary',
    'nursing home',

    // Worship & Spiritual
    'mosque', 'masjid', 'temple', 'church', 'gurudwara', 'synagogue',
    'monastery',

    // Recreation, Nature & Shopping
    'park', 'garden', 'gym', 'fitness', 'club', 'pool', 'playground',
    'stadium', 'sports', 'theatre', 'cinema', 'multiplex', 'mall',
    'market', 'supermarket', 'grocery', 'mart', 'store', 'shop',
    'bazaar', 'shopping',

    // Food, Dining & Social
    'restaurant', 'cafe', 'hotel', 'pub', 'bar', 'eatery', 'bakery',
    'coffee', 'dining', 'amenities', 'infrastructure', 'facilities', 'attractions'
  ];
  return keywords.some(kw => msg.includes(kw));
}
