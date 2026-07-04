This is the dataset I found
price
price in inr.
Address
location of the house.
area
area of the house in sqft.
latitude
longitude
Bedrooms
no of bedrooms.
Bathrooms
no of bathrooms.
Balcony
no of balcony.
Status
is the house ready to move or under construction.
neworold
house is for resale or new
parking
Furnished_status
Lift
Landmarks
type_of_building
desc
Price_sqft


This is the prisma schema used in the website, we are free to change it.

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role {
  ADMIN
  SUBAGENT
  CUSTOMER
}

enum VisitStatus {
  REQUESTED
  APPROVED
  RESCHEDULED
  COMPLETED
  CANCELLED
}

enum LeadStatus {
  NEW
  CONTACTED
  QUALIFIED
  CONVERTED
  LOST
}

enum PropertyStatus {
  DRAFT
  PENDING_APPROVAL
  ACTIVE
  SOLD
  RENTED
  ARCHIVED
  REJECTED
}

enum PropertyType {
  APARTMENT
  VILLA
  PLOT
  OFFICE
  SHOP
  COMMERCIAL
}

enum ListingType {
  SALE
  RENT
}

enum PaymentStatus {
  PENDING
  COMPLETED
  FAILED
  REFUNDED
}

enum PaymentType {
  LISTING_FEE
  REPORT_PURCHASE
  LEAD_UNLOCK
  SUBSCRIPTION
  OTHER
}

enum MessageSenderType {
  USER
  SUBAGENT
  ADMIN
  AI
  SYSTEM
}

enum KYCStatus {
  PENDING
  APPROVED
  REJECTED
}

model User {
  id                        String               @id @default(uuid())
  email                     String               @unique
  emailVerified             Boolean              @default(false)
  passwordHash              String?
  name                      String?
  phone                     String?
  role                      Role                 @default(CUSTOMER)
  kyc                       KYCVerification?
  reviewedKYCVerifications  KYCVerification[]    @relation("KYCReviewedBy")
  propertyAssignments       PropertyAgent[]
  savedProperties           SavedProperty[]
  leadsAsCustomer           Lead[]               @relation("LeadCustomer")
  leadsAsSubagent           Lead[]               @relation("LeadSubagent")
  chatParticipants          ChatParticipant[]
  notifications             Notification[]
  customerVisits            VisitSchedule[]       @relation("VisitCustomer")
  subagentVisits            VisitSchedule[]       @relation("VisitSubagent")
  messages                  Message[]
  mediaUploads              PropertyMedia[]
  payments                  Payment[]
  auditLogs                 AuditLog[]
  aiReports                 AIReport[]
  refreshTokens             RefreshToken[]
  preferences               CustomerPreference?
  recommendations           PropertyRecommendation[]
  deletedAt                 DateTime?
  createdAt                 DateTime             @default(now())
  updatedAt                 DateTime             @updatedAt

  @@map("users")
}

model Locality {
  id           String     @id @default(uuid())
  name         String
  city         String?
  state        String?
  country      String?
  latitude     Float?
  longitude    Float?
  poi          Json?
  intelligence Json?
  properties   Property[]
  deletedAt    DateTime?
  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt

  @@map("localities")
}

model Property {
  id              String            @id @default(uuid())
  title           String
  description     String?
  price           Float?
  address         String?
  latitude        Float?
  longitude       Float?
  locality        Locality?         @relation(fields: [localityId], references: [id])
  localityId      String?
  status          PropertyStatus    @default(DRAFT)
  propertyType    PropertyType
  listingType     ListingType
  isVerified      Boolean           @default(false)
  beds            Int?
  baths           Int?
  sqft            Float?
  yearBuilt       Int?
  approvedBy      String?
  approvedAt      DateTime?
  agents          PropertyAgent[]
  media           PropertyMedia[]
  amenities       PropertyAmenity[]
  leads           Lead[]
  savedBy         SavedProperty[]
  visits          VisitSchedule[]
  recommendations PropertyRecommendation[]
  aiReports       AIReport[]
  deletedAt       DateTime?
  createdAt       DateTime          @default(now())
  updatedAt       DateTime          @updatedAt

  @@index([localityId, status, propertyType])
  @@map("properties")
}

model PropertyAgent {
  id                   String    @id @default(uuid())
  property             Property  @relation(fields: [propertyId], references: [id], onDelete: Cascade)
  propertyId           String
  subagent             User      @relation(fields: [subagentId], references: [id], onDelete: Cascade)
  subagentId           String
  primaryAgent         Boolean   @default(false)
  commissionPercentage Float?
  assignedAt           DateTime  @default(now())
  createdAt            DateTime  @default(now())

  @@unique([propertyId, subagentId])
  @@map("property_agents")
}

model PropertyMedia {
  id           String    @id @default(uuid())
  property     Property  @relation(fields: [propertyId], references: [id], onDelete: Cascade)
  propertyId   String
  fileName     String
  fileType     String
  url          String
  size         Int?
  uploadedBy   User?     @relation(fields: [uploadedById], references: [id])
  uploadedById String?
  createdAt    DateTime  @default(now())

  @@map("property_media")
}

model Amenity {
  id          String           @id @default(uuid())
  name        String           @unique
  description String?
  properties  PropertyAmenity[]

  @@map("amenities")
}

model PropertyAmenity {
  id         String   @id @default(uuid())
  property   Property @relation(fields: [propertyId], references: [id], onDelete: Cascade)
  propertyId String
  amenity    Amenity  @relation(fields: [amenityId], references: [id], onDelete: Cascade)
  amenityId  String
  createdAt  DateTime @default(now())

  @@unique([propertyId, amenityId])
  @@map("property_amenities")
}

model Lead {
  id           String      @id @default(uuid())
  customer     User        @relation("LeadCustomer", fields: [customerId], references: [id], onDelete: Cascade)
  customerId   String
  property     Property    @relation(fields: [propertyId], references: [id], onDelete: Cascade)
  propertyId   String
  subagent     User?       @relation("LeadSubagent", fields: [subagentId], references: [id], onDelete: SetNull)
  subagentId   String?
  status       LeadStatus  @default(NEW)
  isUnlocked   Boolean     @default(false)
  finalizedAt  DateTime?
  notes        String?
  createdAt    DateTime    @default(now())
  updatedAt    DateTime    @updatedAt

  @@index([customerId, subagentId, status])
  @@map("leads")
}

model ChatSession {
  id           String            @id @default(uuid())
  subject      String?
  isAI         Boolean           @default(false)
  metadata     Json?
  participants ChatParticipant[]
  messages     Message[]
  createdAt    DateTime          @default(now())
  updatedAt    DateTime          @updatedAt

  @@map("chat_sessions")
}

model ChatParticipant {
  id         String      @id @default(uuid())
  session    ChatSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  sessionId  String
  user       User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId     String
  role       String?
  createdAt  DateTime    @default(now())

  @@unique([sessionId, userId])
  @@map("chat_participants")
}

model Message {
  id         String            @id @default(uuid())
  session    ChatSession       @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  sessionId  String
  sender     User?             @relation(fields: [senderId], references: [id], onDelete: SetNull)
  senderId   String?
  senderType MessageSenderType
  content    String
  metadata   Json?
  createdAt  DateTime          @default(now())

  @@index([sessionId])
  @@map("messages")
}

model SavedProperty {
  id         String   @id @default(uuid())
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId     String
  property   Property @relation(fields: [propertyId], references: [id], onDelete: Cascade)
  propertyId String
  createdAt  DateTime @default(now())

  @@unique([userId, propertyId])
  @@map("saved_properties")
}

model VisitSchedule {
  id          String      @id @default(uuid())
  property    Property    @relation(fields: [propertyId], references: [id], onDelete: Cascade)
  propertyId  String
  customer    User        @relation("VisitCustomer", fields: [customerId], references: [id], onDelete: Cascade)
  customerId  String
  subagent    User?       @relation("VisitSubagent", fields: [subagentId], references: [id], onDelete: SetNull)
  subagentId  String?
  scheduledAt DateTime
  status      VisitStatus @default(REQUESTED)
  notes       String?
  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt

  @@index([propertyId, customerId])
  @@map("visit_schedules")
}

model Notification {
  id        String   @id @default(uuid())
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId    String
  title     String
  body      String?
  data      Json?
  read      Boolean  @default(false)
  createdAt DateTime @default(now())

  @@index([userId])
  @@map("notifications")
}

model AIReport {
  id         String    @id @default(uuid())
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId     String
  type       String
  title      String?
  content    Json?
  status     String?
  fileUrl    String?
  property   Property? @relation(fields: [propertyId], references: [id], onDelete: SetNull)
  propertyId String?
  createdAt  DateTime  @default(now())

  @@map("ai_reports")
}

model CustomerPreference {
  id          String   @id @default(uuid())
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId      String   @unique
  preferences Json
  updatedAt   DateTime @updatedAt

  @@map("customer_preferences")
}

model PropertyRecommendation {
  id          String    @id @default(uuid())
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId      String
  property    Property  @relation(fields: [propertyId], references: [id], onDelete: Cascade)
  propertyId  String
  score       Float
  explanation String?
  generatedAt DateTime  @default(now())

  @@index([userId, propertyId])
  @@map("property_recommendations")
}

model KYCVerification {
  id           String   @id @default(uuid())
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId       String   @unique
  documents    Json?
  status       KYCStatus @default(PENDING)
  reviewedBy   User?    @relation("KYCReviewedBy", fields: [reviewedById], references: [id], onDelete: SetNull)
  reviewedById  String?
  reviewedAt    DateTime?
  adminFeedback String?  @map("admin_feedback")
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@map("kyc_verifications")
}

model Payment {
  id          String       @id @default(uuid())
  user        User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId      String
  amount      Float
  currency    String
  paymentType PaymentType  @default(OTHER)
  status      PaymentStatus @default(PENDING)
  metadata    Json?
  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @updatedAt

  @@map("payments")
}

model AuditLog {
  id         String   @id @default(uuid())
  actor      User?    @relation(fields: [actorId], references: [id], onDelete: SetNull)
  actorId    String?
  action     String
  resource   String?
  resourceId String?
  metadata   Json?
  createdAt  DateTime @default(now())

  @@map("audit_logs")
}

model RefreshToken {
  id         String   @id @default(uuid())
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId     String
  token      String   @unique
  revoked    Boolean  @default(false)
  expiresAt  DateTime
  createdAt  DateTime @default(now())

  @@map("refresh_tokens")
}
