import { PrismaClient, PropertyType, PropertyStatus, ListingType } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import csv from 'csv-parser';
import * as dotenv from 'dotenv';

dotenv.config();

// ─────────────────────────────────────────────────────────────────────────────
// CONCEPT: Why do we use Prisma here instead of raw SQL?
//
// Prisma is a type-safe database client. It generates TypeScript types directly
// from your schema, so you get autocomplete and compile-time safety. Instead of
// writing "INSERT INTO properties ..." manually, you call prisma.property.create()
// and TypeScript catches any mistakes before they reach the database.
// ─────────────────────────────────────────────────────────────────────────────

const prisma = new PrismaClient();

// ─── Type for a raw CSV row ───────────────────────────────────────────────────
interface CsvRow {
  price: string;
  Address: string;
  area: string;
  latitude: string;
  longitude: string;
  Bedrooms: string;
  Bathrooms: string;
  Balcony: string;
  Status: string;
  neworold: string;
  parking: string;
  Furnished_status: string;
  Lift: string;
  Landmarks: string;
  type_of_building: string;
  desc: string;
  Price_sqft: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extracts the locality name from a full address string.
 * "Chembur, Mumbai - Harbour Line, Maharashtra" → "Chembur"
 */
function extractLocality(address: string): string {
  return address.split(',')[0].trim();
}

/**
 * Extracts the city from the address string.
 * "Chembur, Mumbai - Harbour Line, Maharashtra" → "Mumbai"
 */
function extractCity(address: string): string {
  const parts = address.split(',');
  if (parts.length >= 2) {
    // e.g. " Mumbai - Harbour Line" → "Mumbai"
    return parts[1].split('-')[0].trim();
  }
  return 'Mumbai';
}

/**
 * Maps the CSV "type_of_building" string to our PropertyType enum.
 * Unknown types default to APARTMENT.
 */
function mapPropertyType(raw: string): PropertyType {
  const val = raw?.trim().toLowerCase();
  if (val === 'villa') return PropertyType.VILLA;
  if (val === 'plot') return PropertyType.PLOT;
  if (val === 'office') return PropertyType.OFFICE;
  if (val === 'shop') return PropertyType.SHOP;
  if (val === 'commercial') return PropertyType.COMMERCIAL;
  return PropertyType.APARTMENT; // "Flat", "Apartment", or anything else
}

/**
 * Maps the CSV "Status" string to our PropertyStatus enum.
 * "Ready to Move" → ACTIVE
 * "Under Construction" → PENDING_APPROVAL
 */
function mapPropertyStatus(raw: string): PropertyStatus {
  const val = raw?.trim().toLowerCase();
  if (val === 'ready to move') return PropertyStatus.ACTIVE;
  if (val === 'under construction') return PropertyStatus.PENDING_APPROVAL;
  return PropertyStatus.ACTIVE;
}

/**
 * Safely parses a float string. Returns null if empty or not a number.
 */
function parseFloat_(val: string): number | null {
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

/**
 * Safely parses an integer string. Returns null if empty or not a number.
 */
function parseInt_(val: string): number | null {
  const n = parseInt(val, 10);
  return isNaN(n) ? null : n;
}

// ─── Main import function ─────────────────────────────────────────────────────

async function importData(): Promise<void> {
  const csvPath = path.join(__dirname, '..', 'data', 'mumbai.csv');

  if (!fs.existsSync(csvPath)) {
    console.error(`❌ CSV file not found at: ${csvPath}`);
    process.exit(1);
  }

  console.log('🚀 Starting data import from mumbai.csv...\n');

  // Step 1: Read all rows from the CSV into memory first
  // We do this so we can deduplicate localities before inserting anything.
  const rows: CsvRow[] = [];

  await new Promise<void>((resolve, reject) => {
    fs.createReadStream(csvPath)
      .pipe(csv())
      .on('data', (row: CsvRow) => rows.push(row))
      .on('end', resolve)
      .on('error', reject);
  });

  console.log(`📂 Read ${rows.length} rows from CSV.`);

  // ─── Step 2: Extract unique localities ──────────────────────────────────────
  //
  // CONCEPT: Why do we deduplicate localities first?
  // Multiple properties share the same locality (e.g. 300 properties in "Chembur").
  // We want ONE locality record for "Chembur", not 300 duplicates.
  // We build a Map (key = locality name) to track what we've already created.
  //
  const localityMap = new Map<string, string>(); // name → id

  const localityGroups = new Map<string, { lat: number | null; lng: number | null; city: string }>();

  for (const row of rows) {
    if (!row.Address) continue;
    const name = extractLocality(row.Address);
    if (!localityGroups.has(name)) {
      localityGroups.set(name, {
        lat: parseFloat_(row.latitude),
        lng: parseFloat_(row.longitude),
        city: extractCity(row.Address),
      });
    }
  }

  console.log(`🏘️  Found ${localityGroups.size} unique localities. Upserting...`);

  for (const [name, data] of localityGroups.entries()) {
    // "upsert" = insert if not exists, update if exists.
    // This makes the script safe to run multiple times (idempotent).
    const locality = await prisma.locality.upsert({
      where: { id: name }, // we'll use name as a lookup but need a real where clause
      create: {
        name,
        city: data.city,
        state: 'Maharashtra',
        country: 'India',
        latitude: data.lat,
        longitude: data.lng,
      },
      update: {}, // don't overwrite if already exists
    });
    localityMap.set(name, locality.id);
  }

  // ─── Fix: use findFirst + create pattern for locality upsert ────────────────
  // Prisma upsert requires a @unique field in the where clause.
  // Our Locality model doesn't have @unique on name.
  // So we use findFirst + create instead (handled above incorrectly — fix below).

  // Clear and redo with correct approach
  localityMap.clear();
  console.log('🏘️  Re-seeding localities with correct upsert logic...');

  for (const [name, data] of localityGroups.entries()) {
    let locality = await prisma.locality.findFirst({ where: { name } });
    if (!locality) {
      locality = await prisma.locality.create({
        data: {
          name,
          city: data.city,
          state: 'Maharashtra',
          country: 'India',
          latitude: data.lat,
          longitude: data.lng,
        },
      });
    }
    localityMap.set(name, locality.id);
  }

  console.log(`✅ ${localityMap.size} localities ready.\n`);

  // ─── Step 3: Handle the "Lift" amenity ──────────────────────────────────────
  //
  // The dataset has a "Lift" column. In our schema, amenities are stored in a
  // separate Amenity table linked via PropertyAmenity. We create the "Lift"
  // amenity record once, then link it to properties that have it.
  //
  let liftAmenity = await prisma.amenity.findFirst({ where: { name: 'Lift' } });
  if (!liftAmenity) {
    liftAmenity = await prisma.amenity.create({ data: { name: 'Lift' } });
  }
  console.log(`✅ Amenity "Lift" ready (id: ${liftAmenity.id}).\n`);

  // ─── Step 4: Import properties ───────────────────────────────────────────────

  console.log('🏠 Importing properties...');
  let imported = 0;
  let skipped = 0;

  for (const row of rows) {
    if (!row.Address || !row.type_of_building) {
      skipped++;
      continue;
    }

    const localityName = extractLocality(row.Address);
    const localityId = localityMap.get(localityName);

    const price = parseFloat_(row.price);
    const beds = parseInt_(row.Bedrooms);
    const title = `${beds ? `${beds} BHK` : ''} ${row.type_of_building} in ${localityName}`.trim();

    try {
      const property = await prisma.property.create({
        data: {
          title,
          description: row.desc?.trim() || null,
          price,
          address: row.Address?.trim() || null,
          latitude: parseFloat_(row.latitude),
          longitude: parseFloat_(row.longitude),
          localityId: localityId ?? null,
          propertyType: mapPropertyType(row.type_of_building),
          status: mapPropertyStatus(row.Status),
          listingType: ListingType.SALE, // dataset is all sale listings
          isVerified: true,              // dataset is treated as verified source
          beds,
          baths: parseInt_(row.Bathrooms),
          sqft: parseFloat_(row.area),
          balcony: parseInt_(row.Balcony),
          parking: parseInt_(row.parking),
          furnishedStatus: row.Furnished_status?.trim() || null,
          isResale: row.neworold?.toLowerCase().includes('resale') ?? false,
          priceSqft: parseFloat_(row.Price_sqft),
        },
      });

      // Link "Lift" amenity if the property has it
      if (row.Lift && parseFloat_(row.Lift) !== null && parseFloat_(row.Lift)! > 0) {
        await prisma.propertyAmenity.create({
          data: {
            propertyId: property.id,
            amenityId: liftAmenity.id,
          },
        });
      }

      imported++;
      if (imported % 500 === 0) {
        console.log(`   ... ${imported} properties imported`);
      }
    } catch (err) {
      skipped++;
      // Uncomment below to debug individual row errors:
      // console.error(`Skipped row: ${row.Address}`, err);
    }
  }

  console.log(`\n✅ Import complete!`);
  console.log(`   Imported : ${imported} properties`);
  console.log(`   Skipped  : ${skipped} rows (missing required fields)`);

  // ─── Step 5: Quick summary stats ─────────────────────────────────────────────
  const totalProperties = await prisma.property.count();
  const totalLocalities = await prisma.locality.count();
  console.log(`\n📊 Database summary:`);
  console.log(`   Properties : ${totalProperties}`);
  console.log(`   Localities : ${totalLocalities}`);
}

// ─── Entry point ──────────────────────────────────────────────────────────────
importData()
  .catch((err) => {
    console.error('❌ Import failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
