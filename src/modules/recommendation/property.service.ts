// ─────────────────────────────────────────────────────────────────────────────
// Module 3 — Property Service
//
// CONCEPT: This is the ONLY place in the recommendation engine that talks to
// the database. The scorer and orchestrator never call Prisma directly.
//
// Separation of concerns:
//   property.service.ts → DB queries (Prisma)
//   scorer.ts           → Scoring logic (pure functions)
//   recommendation.service.ts → Orchestration (calls both)
//
// Hard filters applied here (in SQL, before data hits Node.js):
//   - status = ACTIVE          (no drafts or archived listings)
//   - propertyType matches     (if user specified)
//   - listingType matches      (if user specified SALE/RENT)
//   - beds within range        (bedroomsMin ±1 for flexibility)
//   - price within budget      (up to 110% for slight flexibility)
//   - locality name match      (if user specified)
//
// We fetch a CANDIDATE POOL (up to `poolSize`) for the scorer to rank.
// Fetching more candidates = better final ranking.
// ─────────────────────────────────────────────────────────────────────────────

import { PrismaClient, Prisma } from '@prisma/client';
import { UserPreferences, RawProperty } from './types';

// ─── Singleton Prisma client ──────────────────────────────────────────────────
//
// CONCEPT: PrismaClient is expensive to instantiate. We reuse one instance
// across all requests (singleton pattern). In production this would live in
// a shared db.ts module.
//
let _prisma: PrismaClient | null = null;

function getPrisma(): PrismaClient {
  if (!_prisma) {
    _prisma = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
  }
  return _prisma;
}

// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_POOL_SIZE = 50;   // Fetch up to 50 candidates, score them all
const BUDGET_FLEX = 1.10;       // Allow prices up to 10% over budget

/**
 * Fetch a pool of candidate properties from the database that broadly match
 * the user's preferences. Returns slim RawProperty objects (not full Prisma rows).
 *
 * @param prefs   - The accumulated user preferences
 * @param poolSize - Max number of candidates to fetch (default 50)
 */
export async function fetchCandidates(
  prefs: Partial<UserPreferences>,
  poolSize = DEFAULT_POOL_SIZE,
): Promise<RawProperty[]> {
  const prisma = getPrisma();

  // Build WHERE clause dynamically based on what the user specified
  const where: Prisma.PropertyWhereInput = {
    status: 'ACTIVE',
    deletedAt: null,
  };

  // Property type filter
  if (prefs.propertyType) {
    where.propertyType = prefs.propertyType as any;
  }

  // Listing type filter (SALE / RENT)
  if (prefs.listingType) {
    where.listingType = prefs.listingType as any;
  }

  // Bedrooms filter (allow ±1 flexibility)
  if (prefs.bedroomsMin != null) {
    where.beds = {
      gte: Math.max(1, prefs.bedroomsMin - 1),
      lte: prefs.bedroomsMin + 1,
    };
  }

  // Budget filter (allow up to 10% over)
  if (prefs.budgetMax != null) {
    where.price = {
      lte: prefs.budgetMax * BUDGET_FLEX,
    };
  }


  // Locality filter — use OR + contains because DB stores full address strings
  // e.g. "Andheri" must match "Andheri West", "Andheri East", "Lokhandwala Andheri West..."
  if (prefs.localities && prefs.localities.length > 0) {
    where.locality = {
      OR: prefs.localities.map(loc => ({
        name: { contains: loc, mode: 'insensitive' as const },
      })),
    };
  }


  const rows = await prisma.property.findMany({
    where,
    take: poolSize,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      price: true,
      beds: true,
      baths: true,
      sqft: true,
      address: true,
      propertyType: true,
      listingType: true,
      furnishedStatus: true,
      isResale: true,
      priceSqft: true,
      locality: {
        select: { name: true },
      },
    },
  });

  // Map Prisma rows → RawProperty (flatten the locality relation)
  return rows.map(row => ({
    id: row.id,
    title: row.title,
    price: row.price,
    beds: row.beds,
    baths: row.baths,
    sqft: row.sqft,
    address: row.address,
    localityName: row.locality?.name ?? null,
    propertyType: row.propertyType,
    listingType: row.listingType,
    furnishedStatus: row.furnishedStatus,
    isResale: row.isResale,
    priceSqft: row.priceSqft,
  }));
}
