-- CreateEnum
CREATE TYPE "AthleteStatus" AS ENUM ('FIN', 'DNF', 'DSQ', 'DNS');

-- AlterTable: cast existing string values to enum; rows with unrecognized status
-- (e.g. empty string) default to 'FIN' so existing data is not lost.
ALTER TABLE "Athlete"
  ALTER COLUMN "status" TYPE "AthleteStatus"
    USING CASE
      WHEN "status" = 'FIN' THEN 'FIN'::"AthleteStatus"
      WHEN "status" = 'DNF' THEN 'DNF'::"AthleteStatus"
      WHEN "status" = 'DSQ' THEN 'DSQ'::"AthleteStatus"
      WHEN "status" = 'DNS' THEN 'DNS'::"AthleteStatus"
      ELSE 'FIN'::"AthleteStatus"
    END,
  ALTER COLUMN "finishTime" DROP NOT NULL;
