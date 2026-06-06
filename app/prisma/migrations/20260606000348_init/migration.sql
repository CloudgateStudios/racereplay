-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('TRIATHLON', 'ROAD_RACE');

-- CreateTable
CREATE TABLE "Race" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Race_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" SERIAL NOT NULL,
    "raceId" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "type" "EventType" NOT NULL,
    "date" DATE NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Segment" (
    "id" SERIAL NOT NULL,
    "eventId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "displayOrder" INTEGER NOT NULL,

    CONSTRAINT "Segment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Athlete" (
    "id" SERIAL NOT NULL,
    "eventId" INTEGER NOT NULL,
    "bib" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gender" TEXT NOT NULL,
    "division" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "finishTime" TEXT NOT NULL,
    "overallRank" INTEGER,
    "genderRank" INTEGER,
    "divisionRank" INTEGER,

    CONSTRAINT "Athlete_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AthleteSegment" (
    "id" SERIAL NOT NULL,
    "athleteId" INTEGER NOT NULL,
    "segmentId" INTEGER NOT NULL,
    "timeSeconds" DOUBLE PRECISION,
    "gained" INTEGER,
    "lost" INTEGER,
    "net" INTEGER,

    CONSTRAINT "AthleteSegment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Race_slug_key" ON "Race"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Event_raceId_year_key" ON "Event"("raceId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "Athlete_eventId_bib_key" ON "Athlete"("eventId", "bib");

-- CreateIndex
CREATE UNIQUE INDEX "AthleteSegment_athleteId_segmentId_key" ON "AthleteSegment"("athleteId", "segmentId");

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_raceId_fkey" FOREIGN KEY ("raceId") REFERENCES "Race"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Segment" ADD CONSTRAINT "Segment_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Athlete" ADD CONSTRAINT "Athlete_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AthleteSegment" ADD CONSTRAINT "AthleteSegment_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "Athlete"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AthleteSegment" ADD CONSTRAINT "AthleteSegment_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "Segment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
