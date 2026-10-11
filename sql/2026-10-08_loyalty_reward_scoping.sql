-- =============================================================================
-- 2026-10-08_loyalty_reward_scoping.sql
--
-- Reward redemption had no notion of *what* a reward applies to. `loyalty_rewards`
-- carried property_id, name, points_cost, image, stock — and nothing else. So:
--
--   * "Executive Room Upgrade 1 Night" was redeemable for a two-week booking in a
--      standard twin, or for a stay three months out, or for dates that have already
--     passed.
--   * The only scoping was the property slug in the URL, and the portal could not name
--     a property (the login payload has no property), so it probed until it found one
--     with rewards — which is property 999 only. Every other hotel had an empty
--     catalogue.
--
-- This adds the fields a redemption actually needs to be valid, so the check is the
-- server's job instead of the guest's guess.
--
-- Idempotent: each column is added only when absent. MySQL has no
-- `ADD COLUMN IF NOT EXISTS`, hence the information_schema guard + prepared statement.
--
-- NOTE: loyalty_rewards lives in the Booking Engine MySQL database (`draft_hmsbooking`),
-- not in HMS Postgres. There is a single physical table; both stacks read and write it
-- through their own connection (Laravel `hmsbooking`, Node `DB_HMSBOOK_*`).
-- =============================================================================

DROP PROCEDURE IF EXISTS AddLoyaltyRewardColumn;
DELIMITER //
CREATE PROCEDURE AddLoyaltyRewardColumn(IN col VARCHAR(64), IN ddl VARCHAR(255))
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'loyalty_rewards' AND COLUMN_NAME = col
  ) THEN
    SET @sql = CONCAT('ALTER TABLE loyalty_rewards ADD COLUMN ', col, ' ', ddl);
    PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;
END //
DELIMITER ;

-- Which room type the reward applies to. NULL = any room type at the property.
CALL AddLoyaltyRewardColumn('room_type_id', 'BIGINT NULL AFTER property_id');

-- The window the stay has to fall inside. NULL on either side = unbounded that way.
CALL AddLoyaltyRewardColumn('valid_from', 'DATE NULL AFTER room_type_id');
CALL AddLoyaltyRewardColumn('valid_until', 'DATE NULL AFTER valid_from');

-- Length-of-stay gate. "Breakfast for 2" is fine on a single night; a free night is not
-- meaningful on one.
CALL AddLoyaltyRewardColumn('min_nights', 'INT NULL AFTER valid_until');
CALL AddLoyaltyRewardColumn('max_nights', 'INT NULL AFTER min_nights');

-- 'benefit' = a service the front desk fulfils (late checkout, upgrade).
-- 'discount' = money off the folio, and then the two below decide how much.
CALL AddLoyaltyRewardColumn('redemption_type', "VARCHAR(20) NOT NULL DEFAULT 'benefit' AFTER max_nights");
CALL AddLoyaltyRewardColumn('discount_type', "VARCHAR(20) NULL AFTER redemption_type");
CALL AddLoyaltyRewardColumn('discount_value', 'DECIMAL(12,2) NULL AFTER discount_type');

DROP PROCEDURE IF EXISTS AddLoyaltyRewardColumn;

-- -----------------------------------------------------------------------------
-- Give the other published properties a catalogue.
--
-- Only 999 held rewards, so a member who signed in and resolved to HOTEL OLIVE, Ow!
-- Hotel, or Anyaman saw "no rewards available" on a page that looked broken. Each set
-- is written for that property rather than copied between them — a city hotel does not
-- offer an onsen pass.
--
-- Guarded on name so re-running does not duplicate, and scoped per property so the same
-- reward name can exist at two hotels without one hiding the other.
-- -----------------------------------------------------------------------------

INSERT INTO loyalty_rewards
  (property_id, room_type_id, name, description, points_cost, stock, sort, status,
   redemption_type, discount_type, discount_value, valid_from, valid_until, min_nights, max_nights)
SELECT * FROM (
  SELECT 1000 AS property_id, NULL AS room_type_id,
         'Welcome Fruit Basket' AS name,
         'A seasonal fruit basket in your room on arrival.' AS description,
         2500 AS points_cost, NULL AS stock, 1 AS sort, 1 AS status,
         'benefit' AS redemption_type, NULL AS discount_type, NULL AS discount_value,
         NULL AS valid_from, NULL AS valid_until, NULL AS min_nights, NULL AS max_nights
  UNION ALL SELECT 1000, NULL, 'Late Check-Out Until 14:00',
         'Keep your room until 2pm, subject to availability.', 5000, NULL, 2, 1,
         'benefit', NULL, NULL, NULL, NULL, 2, NULL
  UNION ALL SELECT 1000, NULL, 'Breakfast Buffet for 2',
         'Breakfast for two at the all-day dining restaurant.', 7500, 20, 3, 1,
         'benefit', NULL, NULL, NULL, NULL, 1, NULL
  UNION ALL SELECT 1000, NULL, 'Room Upgrade',
         'One-category upgrade, confirmed at check-in.', 20000, 5, 4, 1,
         'benefit', NULL, NULL, NULL, NULL, 2, NULL
) AS seed
WHERE NOT EXISTS (
  SELECT 1 FROM loyalty_rewards lr
   WHERE lr.property_id = seed.property_id AND lr.name = seed.name AND lr.deleted_at IS NULL
);

INSERT INTO loyalty_rewards
  (property_id, room_type_id, name, description, points_cost, stock, sort, status,
   redemption_type, discount_type, discount_value, valid_from, valid_until, min_nights, max_nights)
SELECT * FROM (
  SELECT 1002 AS property_id, NULL AS room_type_id,
         'Welcome Drink' AS name,
         'Two welcome drinks at the lobby bar.' AS description,
         2000 AS points_cost, NULL AS stock, 1 AS sort, 1 AS status,
         'benefit' AS redemption_type, NULL AS discount_type, NULL AS discount_value,
         NULL AS valid_from, NULL AS valid_until, NULL AS min_nights, NULL AS max_nights
  UNION ALL SELECT 1002, NULL, 'Late Check-Out Until 14:00',
         'Keep your room until 2pm, subject to availability.', 5000, NULL, 2, 1,
         'benefit', NULL, NULL, NULL, NULL, 1, NULL
  UNION ALL SELECT 1002, NULL, 'Breakfast Buffet for 2',
         'Breakfast for two, served in Olive Restaurant.', 7000, 15, 3, 1,
         'benefit', NULL, NULL, NULL, NULL, 1, NULL
  UNION ALL SELECT 1002, NULL, '10% Off Your Room Rate',
         'A 10% discount applied to the room charge of the selected stay.', 9000, 10, 4, 1,
         'discount', 'percent', 10.00, NULL, NULL, 1, 14
) AS seed
WHERE NOT EXISTS (
  SELECT 1 FROM loyalty_rewards lr
   WHERE lr.property_id = seed.property_id AND lr.name = seed.name AND lr.deleted_at IS NULL
);

INSERT INTO loyalty_rewards
  (property_id, room_type_id, name, description, points_cost, stock, sort, status,
   redemption_type, discount_type, discount_value, valid_from, valid_until, min_nights, max_nights)
SELECT * FROM (
  SELECT 1003 AS property_id, NULL AS room_type_id,
         'Welcome Fruit Platter' AS name,
         'A fresh fruit platter in your room on arrival.' AS description,
         2500 AS points_cost, NULL AS stock, 1 AS sort, 1 AS status,
         'benefit' AS redemption_type, NULL AS discount_type, NULL AS discount_value,
         NULL AS valid_from, NULL AS valid_until, NULL AS min_nights, NULL AS max_nights
  UNION ALL SELECT 1003, NULL, 'Complimentary Airport Pickup',
         'One-way pickup within the city, needs 24h notice.', 12000, NULL, 2, 1,
         'benefit', NULL, NULL, NULL, NULL, 1, NULL
  UNION ALL SELECT 1003, NULL, 'Rp 100.000 Off Your Stay',
         'A fixed discount applied to the room charge of the selected stay.', 8000, 20, 3, 1,
         'discount', 'amount', 100000.00, NULL, NULL, 1, NULL
) AS seed
WHERE NOT EXISTS (
  SELECT 1 FROM loyalty_rewards lr
   WHERE lr.property_id = seed.property_id AND lr.name = seed.name AND lr.deleted_at IS NULL
);

-- Backfill the existing 999 rewards with sensible gates now that the columns exist.
-- Left well-enough alone otherwise: these are an operator's rows, not seed data.
UPDATE loyalty_rewards SET min_nights = 2
 WHERE property_id = 999 AND name IN ('Executive Room Upgrade 1 Night') AND min_nights IS NULL;
UPDATE loyalty_rewards SET min_nights = 1
 WHERE property_id = 999 AND name IN ('Breakfast Buffet 2 Pax', 'Free Onsen Access 2 Pax') AND min_nights IS NULL;

-- Verify:
--   select property_id, name, redemption_type, discount_type, discount_value, min_nights
--     from loyalty_rewards where deleted_at is null order by property_id, sort;
