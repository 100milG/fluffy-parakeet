import { UserPreferences, RawProperty, ScoredProperty } from './types';

const WEIGHTS = {
  budget:      30,
  beds:        20,
  locality:    20,
  furnished:   10,
  readyToMove: 10,
  listingType: 10,
} as const;

export function scoreProperty(
  property: RawProperty,
  prefs: Partial<UserPreferences>,
): ScoredProperty {
  let score = 0;
  const breakdown: Record<string, number> = {};

  // 1. Budget
  if (prefs.budgetMax != null && property.price != null) {
    const max = prefs.budgetMax;
    const price = property.price;
    if (price <= max) {
      breakdown['budget'] = WEIGHTS.budget;
    } else if (price <= max * 1.1) {
      const overBy = (price - max) / (max * 0.1);
      breakdown['budget'] = Math.round(WEIGHTS.budget * (1 - overBy));
    } else {
      breakdown['budget'] = 0;
    }
  } else {
    breakdown['budget'] = Math.round(WEIGHTS.budget / 2);
  }

  // 2. Bedrooms
  if (prefs.bedroomsMin != null && property.beds != null) {
    const diff = Math.abs(property.beds - prefs.bedroomsMin);
    if (diff === 0) {
      breakdown['beds'] = WEIGHTS.beds;
    } else if (diff === 1) {
      breakdown['beds'] = Math.round(WEIGHTS.beds / 2);
    } else {
      breakdown['beds'] = 0;
    }
  } else {
    breakdown['beds'] = Math.round(WEIGHTS.beds / 2);
  }

  // 3. Locality
  if (prefs.localities && prefs.localities.length > 0 && property.localityName) {
    const propLocLower = property.localityName.toLowerCase();
    const matched = prefs.localities.some(loc =>
      propLocLower.includes(loc.toLowerCase()) ||
      loc.toLowerCase().includes(propLocLower),
    );
    breakdown['locality'] = matched ? WEIGHTS.locality : 0;
  } else {
    breakdown['locality'] = Math.round(WEIGHTS.locality / 2);
  }

  // 4. Furnished status
  if (prefs.furnishedStatus && property.furnishedStatus) {
    const match =
      property.furnishedStatus.toLowerCase() === prefs.furnishedStatus.toLowerCase();
    breakdown['furnished'] = match ? WEIGHTS.furnished : 0;
  } else {
    breakdown['furnished'] = Math.round(WEIGHTS.furnished / 2);
  }

  // 5. Ready to move
  if (prefs.mustHaves?.includes('ready_to_move')) {
    const isReady =
      property.isResale === true ||
      (property.furnishedStatus != null && property.furnishedStatus !== 'Unfurnished');
    breakdown['readyToMove'] = isReady ? WEIGHTS.readyToMove : 0;
  } else {
    breakdown['readyToMove'] = Math.round(WEIGHTS.readyToMove / 2);
  }

  // 6. Listing type
  if (prefs.listingType && property.listingType) {
    breakdown['listingType'] =
      property.listingType === prefs.listingType ? WEIGHTS.listingType : 0;
  } else {
    breakdown['listingType'] = Math.round(WEIGHTS.listingType / 2);
  }

  // Total
  score = Object.values(breakdown).reduce((a, b) => a + b, 0);

  return { ...property, score, breakdown };
}

export function rankProperties(
  properties: RawProperty[],
  prefs: Partial<UserPreferences>,
): ScoredProperty[] {
  return properties
    .map(p => scoreProperty(p, prefs))
    .sort((a, b) => b.score - a.score);
}
