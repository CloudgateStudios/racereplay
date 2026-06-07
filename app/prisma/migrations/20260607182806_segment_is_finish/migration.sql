/*
  Warnings:

  - Made the column `finishTime` on table `Athlete` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Athlete" ALTER COLUMN "finishTime" SET NOT NULL;

-- AlterTable
ALTER TABLE "Segment" ADD COLUMN     "isFinish" BOOLEAN NOT NULL DEFAULT false;
