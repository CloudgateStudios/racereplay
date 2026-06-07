-- AlterTable
ALTER TABLE "Athlete" ADD COLUMN     "city" TEXT,
ADD COLUMN     "team" TEXT,
ADD COLUMN     "waveTime" TEXT;

-- AlterTable
ALTER TABLE "AthleteSegment" ADD COLUMN     "epochTime" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "CategoryResult" (
    "id" SERIAL NOT NULL,
    "eventId" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "total" INTEGER NOT NULL,

    CONSTRAINT "CategoryResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CategoryResult_eventId_category_name_key" ON "CategoryResult"("eventId", "category", "name");

-- AddForeignKey
ALTER TABLE "CategoryResult" ADD CONSTRAINT "CategoryResult_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
