WITH duplicates AS (
  SELECT account
  FROM guest_profiles
  WHERE account IS NOT NULL AND account != ''
  GROUP BY account
  HAVING count(*) > 1
)
UPDATE guest_profiles
SET account = account || '-dup-' || id
WHERE id IN (
  SELECT id
  FROM (
    SELECT id, row_number() OVER (PARTITION BY account ORDER BY id ASC) as rn
    FROM guest_profiles
    WHERE account IN (SELECT account FROM duplicates)
  ) sub
  WHERE rn > 1
);

ALTER TABLE guest_profiles ADD CONSTRAINT guest_profiles_account_unique UNIQUE (account);
