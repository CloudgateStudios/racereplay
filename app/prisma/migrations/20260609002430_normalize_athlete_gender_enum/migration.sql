-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('Male', 'Female', 'Open', 'Unknown');

-- AlterTable — convert existing string values to the new enum.
-- 'Male' and 'Female' map directly; anything else (empty string, etc.)
-- becomes 'Unknown'.
ALTER TABLE "Athlete"
  ALTER COLUMN "gender" TYPE "Gender"
  USING (
    CASE "gender"
      WHEN 'Male'   THEN 'Male'::"Gender"
      WHEN 'Female' THEN 'Female'::"Gender"
      WHEN 'Open'   THEN 'Open'::"Gender"
      ELSE 'Unknown'::"Gender"
    END
  );
