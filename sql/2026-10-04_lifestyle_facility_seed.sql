-- Lifestyle facility + terms seed for every property.
--
-- Why: /content/lifestyle-facility?parent=1091 (HMS) held exactly ONE row in the
-- whole database (property 999 "pool"), so the guest portal at
-- http://localhost:3002/lifestyle rendered a property card with a single amenity
-- or none at all. The booking engine reads this data through
-- GET /middleware/lifestyle/properties
-- (LifestyleController::propertiesForBookingEngine -> backend-node), which returns
-- `facilities: [{key,label,icon}]` per property, so empty tables mean an empty
-- portal rather than a fallback problem.
--
-- The facility_key values below all come from the master list in
-- backend-node/src/controllers/lifestyle.controller.ts (LIFESTYLE_FACILITY_KEYS),
-- which this change expands from 7 to 45 keys. `icon` holds the react-icons
-- component name the booking engine renders.
--
-- Sets are written per property to match what each hotel actually is: a Japanese
-- ryokan in South Jakarta is not a beachfront chalet in Labuan Bajo, and one
-- generic "everything everywhere" list would misrepresent both.
--
-- Idempotent: a (property_id, facility_key) pair that already exists is left
-- untouched, so operator edits survive a re-run.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 999 KURETAKESO - Japanese ryokan, Kebayoran Baru, South Jakarta
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO property_lifestyle_facilities (property_id, facility_key, label, icon, sort, status, created_at, updated_at)
SELECT 999, v.facility_key, v.label, v.icon, v.sort, 1, now(), now()
FROM (VALUES
  ('onsen',              'Onsen',                  'HotTub',        1),
  ('pool',               'Swimming Pool',          'SwimmingPool',  2),
  ('sauna',              'Sauna',                  'HotTub',        3),
  ('massage',            'Massage',                'HandPaper',     4),
  ('restaurant_japanese','Japanese Restaurant',    'Utensils',      5),
  ('restaurant',         'Restaurant',             'Utensils',      6),
  ('breakfast',          'Breakfast Included',     'Coffee',        7),
  ('room_service',       'Room Service',           'ConciergeBell', 8),
  ('wifi',               'Free WiFi',              'Wifi',          9),
  ('parking',            'Free Parking',           'Parking',       10),
  ('air_conditioning',   'Air Conditioning',       'Snowflake',     11),
  ('non_smoking_room',   'Non-Smoking Room',       'Ban',           12),
  ('mini_bar',           'Mini Coolbar',           'GlassCheers',   13),
  ('flat_tv',            '43" Smart TV',           'Tv',            14),
  ('coffee_maker',       'Coffee Maker',           'Coffee',        15),
  ('safe',               'In-Room Safe',           'Lock',          16),
  ('hairdryer',          'Hairdryer',              'Wind',          17),
  ('bathtub',            'Bathtub',                'Bath',          18),
  ('shower',             'Shower',                 'Shower',        19),
  ('laundry',            'Laundry Service',        'Tshirt',        20),
  ('luggage_storage',    'Luggage Storage',        'Suitcase',      21),
  ('concierge',          'Concierge',              'ConciergeBell', 22),
  ('room_service_24h',   '24-Hour Reception',      'ConciergeBell', 23),
  ('security',           '24-Hour Security',       'ShieldAlt',     24),
  ('cctv',               'CCTV',                   'Video',         25),
  ('fire_safety',        'Fire Safety',            'Fire',          26),
  ('family_room',        'Family Friendly',        'Users',         27),
  ('kids_pool',          'Kids Pool',              'SwimmingPool',  28)
) AS v(facility_key, label, icon, sort)
WHERE NOT EXISTS (
  SELECT 1 FROM property_lifestyle_facilities f
  WHERE f.property_id = 999 AND f.facility_key = v.facility_key AND f.deleted_at IS NULL
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 1000 Anyaman - corporate residence, Tangerang
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO property_lifestyle_facilities (property_id, facility_key, label, icon, sort, status, created_at, updated_at)
SELECT 1000, v.facility_key, v.label, v.icon, v.sort, 1, now(), now()
FROM (VALUES
  ('wifi',              'Free WiFi',              'Wifi',          1),
  ('parking',           'Free Parking',           'Parking',       2),
  ('breakfast',         'Breakfast Included',     'Coffee',        3),
  ('restaurant',        'Restaurant',             'Utensils',      4),
  ('cafe',              'Cafe',                   'Coffee',        5),
  ('gym',               'Fitness Centre',         'Dumbbell',      6),
  ('pool',              'Swimming Pool',          'SwimmingPool',  7),
  ('business_center',   'Business Centre',        'Briefcase',     8),
  ('meeting_room',      'Meeting Room',           'Users',         9),
  ('conference_room',   'Conference Room',        'Users',         10),
  ('airport_shuttle',   'Airport Shuttle',        'ShuttleVan',    11),
  ('air_conditioning',  'Air Conditioning',       'Snowflake',     12),
  ('non_smoking_room',  'Non-Smoking Room',       'Ban',           13),
  ('mini_bar',          'Mini Bar',               'GlassCheers',   14),
  ('flat_tv',           'Flat-Screen TV',         'Tv',            15),
  ('kettle',            'Electric Kettle',        'MugHot',        16),
  ('safe',              'In-Room Safe',           'Lock',          17),
  ('hairdryer',         'Hairdryer',              'Wind',          18),
  ('shower',            'Shower',                 'Shower',        19),
  ('laundry',           'Laundry Service',        'Tshirt',        20),
  ('ironing',           'Ironing Service',        'Tshirt',        21),
  ('luggage_storage',   'Luggage Storage',        'Suitcase',      22),
  ('currency_exchange', 'Currency Exchange',       'MoneyBillWave', 23),
  ('concierge',         'Concierge',              'ConciergeBell', 24),
  ('room_service_24h',  '24-Hour Reception',      'ConciergeBell', 25),
  ('security',          '24-Hour Security',       'ShieldAlt',     26),
  ('family_room',       'Family Room',            'Users',         27)
) AS v(facility_key, label, icon, sort)
WHERE NOT EXISTS (
  SELECT 1 FROM property_lifestyle_facilities f
  WHERE f.property_id = 1000 AND f.facility_key = v.facility_key AND f.deleted_at IS NULL
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 1002 HOTEL OLIVE - green-themed business hotel, Tangerang
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO property_lifestyle_facilities (property_id, facility_key, label, icon, sort, status, created_at, updated_at)
SELECT 1002, v.facility_key, v.label, v.icon, v.sort, 1, now(), now()
FROM (VALUES
  ('wifi',              'Free WiFi',              'Wifi',          1),
  ('parking',           'Free Parking',           'Parking',       2),
  ('valet_parking',     'Valet Parking',          'Parking',       3),
  ('breakfast',         'Breakfast Included',     'Coffee',        4),
  ('restaurant',        'Restaurant',             'Utensils',      5),
  ('cafe',              'Cafe',                   'Coffee',        6),
  ('room_service',      'Room Service',           'ConciergeBell', 7),
  ('gym',               'Fitness Centre',         'Dumbbell',      8),
  ('pool',              'Swimming Pool',          'SwimmingPool',  9),
  ('spa',               'Spa',                    'Spa',           10),
  ('massage',           'Massage',                'HandPaper',     11),
  ('business_center',   'Business Centre',        'Briefcase',     12),
  ('meeting_room',      'Meeting Room',           'Users',         13),
  ('conference_room',   'Conference Room',        'Users',         14),
  ('airport_transfer',  'Airport Transfer',       'ShuttleVan',    15),
  ('air_conditioning',  'Air Conditioning',       'Snowflake',     16),
  ('non_smoking_room',  'Non-Smoking Room',       'Ban',           17),
  ('smoking_room',      'Smoking Room',           'Smoking',       18),
  ('mini_bar',          'Mini Bar',               'GlassCheers',   19),
  ('flat_tv',           'Flat-Screen TV',         'Tv',            20),
  ('safe',              'In-Room Safe',           'Lock',          21),
  ('hairdryer',         'Hairdryer',              'Wind',          22),
  ('bathtub',           'Bathtub',                'Bath',          23),
  ('shower',            'Shower',                 'Shower',        24),
  ('laundry',           'Laundry Service',        'Tshirt',        25),
  ('concierge',         'Concierge',              'ConciergeBell', 26),
  ('room_service_24h',  '24-Hour Reception',      'ConciergeBell', 27),
  ('security',          '24-Hour Security',       'ShieldAlt',     28),
  ('cctv',              'CCTV',                   'Video',         29),
  ('garden',            'Garden',                 'Tree',          30)
) AS v(facility_key, label, icon, sort)
WHERE NOT EXISTS (
  SELECT 1 FROM property_lifestyle_facilities f
  WHERE f.property_id = 1002 AND f.facility_key = v.facility_key AND f.deleted_at IS NULL
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 1003 Ow! Hotel - urban lifestyle hotel, North Jakarta
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO property_lifestyle_facilities (property_id, facility_key, label, icon, sort, status, created_at, updated_at)
SELECT 1003, v.facility_key, v.label, v.icon, v.sort, 1, now(), now()
FROM (VALUES
  ('wifi',              'Free WiFi',              'Wifi',          1),
  ('internet',          'High-Speed Internet',    'Globe',         2),
  ('bar',               'Rooftop Bar',            'Cocktail',      3),
  ('lounge',            'Lounge',                 'Couch',         4),
  ('restaurant',        'Restaurant',             'Utensils',      5),
  ('cafe',              'Cafe',                   'Coffee',        6),
  ('room_service',      'Room Service',           'ConciergeBell', 7),
  ('breakfast',         'Breakfast Included',     'Coffee',        8),
  ('gym',               'Fitness Centre',         'Dumbbell',      9),
  ('yoga',              'Yoga Class',             'Fire',          10),
  ('pool',              'Swimming Pool',          'SwimmingPool',  11),
  ('pool_bar',          'Pool Bar',               'Cocktail',      12),
  ('business_center',   'Business Centre',        'Briefcase',     13),
  ('meeting_room',      'Meeting Room',           'Users',         14),
  ('parking',           'Free Parking',           'Parking',       15),
  ('ev_charging',       'EV Charging',            'Car',           16),
  ('bike_rental',       'Bicycle Rental',         'Bicycle',       17),
  ('taxi',              'Taxi Service',           'Taxi',          18),
  ('air_conditioning',  'Air Conditioning',       'Snowflake',     19),
  ('non_smoking_room',  'Non-Smoking Room',       'Ban',           20),
  ('smoking_room',      'Smoking Room',           'Smoking',       21),
  ('mini_bar',          'Mini Bar',               'GlassCheers',   22),
  ('flat_tv',           'Flat-Screen TV',         'Tv',            23),
  ('safe',              'In-Room Safe',           'Lock',          24),
  ('hairdryer',         'Hairdryer',              'Wind',          25),
  ('shower',            'Shower',                 'Shower',        26),
  ('luggage_storage',   'Luggage Storage',        'Suitcase',      27),
  ('concierge',         'Concierge',              'ConciergeBell', 28),
  ('room_service_24h',  '24-Hour Reception',      'ConciergeBell', 29),
  ('security',          '24-Hour Security',       'ShieldAlt',     30),
  ('ticketing',         'Ticket Service',         'TicketAlt',     31),
  ('tour_desk',         'Tour Desk',              'MapMarkedAlt',  32)
) AS v(facility_key, label, icon, sort)
WHERE NOT EXISTS (
  SELECT 1 FROM property_lifestyle_facilities f
  WHERE f.property_id = 1003 AND f.facility_key = v.facility_key AND f.deleted_at IS NULL
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 1004 Shangri-La - luxury city hotel, Central Jakarta
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO property_lifestyle_facilities (property_id, facility_key, label, icon, sort, status, created_at, updated_at)
SELECT 1004, v.facility_key, v.label, v.icon, v.sort, 1, now(), now()
FROM (VALUES
  ('wifi',                     'Free WiFi',              'Wifi',          1),
  ('internet',                 'High-Speed Internet',    'Globe',         2),
  ('restaurant',               'Restaurant',             'Utensils',      3),
  ('restaurant_japanese',      'Japanese Restaurant',    'Utensils',      4),
  ('restaurant_chinese',       'Chinese Restaurant',     'Utensils',      5),
  ('restaurant_western',       'Western Restaurant',     'Utensils',      6),
  ('cafe',                     'Cafe',                   'Coffee',        7),
  ('bar',                      'Bar',                    'Cocktail',      8),
  ('lounge',                   'Executive Lounge',       'Couch',         9),
  ('room_service',             '24-Hour Room Service',   'ConciergeBell', 10),
  ('breakfast',                'Breakfast Included',     'Coffee',        11),
  ('buffet',                   'Buffet',                 'Utensils',      12),
  ('pool',                     'Swimming Pool',          'SwimmingPool',  13),
  ('pool_indoor',              'Indoor Pool',            'SwimmingPool',  14),
  ('kids_pool',                'Kids Pool',              'SwimmingPool',  15),
  ('pool_bar',                 'Pool Bar',               'Cocktail',      16),
  ('spa',                      'Spa',                    'Spa',           17),
  ('massage',                  'Massage',                'HandPaper',     18),
  ('sauna',                    'Sauna',                  'HotTub',        19),
  ('steam_room',               'Steam Room',             'HotTub',        20),
  ('jacuzzi',                  'Jacuzzi',                'HotTub',        21),
  ('gym',                      'Fitness Centre',         'Dumbbell',      22),
  ('yoga',                     'Yoga',                   'Fire',          23),
  ('business_center',          'Business Centre',        'Briefcase',     24),
  ('meeting_room',             'Meeting Room',           'Users',         25),
  ('conference_room',          'Conference Room',        'Users',         26),
  ('valet_parking',            'Valet Parking',          'Parking',       27),
  ('airport_transfer',         'Airport Transfer',       'ShuttleVan',    28),
  ('taxi',                     'Taxi Service',           'Taxi',          29),
  ('air_conditioning',         'Air Conditioning',       'Snowflake',     30),
  ('non_smoking_room',         'Non-Smoking Room',       'Ban',           31),
  ('mini_bar',                 'Mini Bar',               'GlassCheers',   32),
  ('flat_tv',                  'Flat-Screen TV',         'Tv',            33),
  ('cable_tv',                 'Cable TV',               'Tv',            34),
  ('coffee_maker',             'Coffee Maker',           'Coffee',        35),
  ('kettle',                   'Electric Kettle',        'MugHot',        36),
  ('safe',                     'In-Room Safe',           'Lock',          37),
  ('hairdryer',                'Hairdryer',              'Wind',          38),
  ('bathtub',                  'Bathtub',                'Bath',          39),
  ('shower',                   'Rain Shower',            'Shower',        40),
  ('laundry',                  'Laundry Service',        'Tshirt',        41),
  ('dry_cleaning',             'Dry Cleaning',           'Tshirt',        42),
  ('ironing',                  'Ironing Service',        'Tshirt',        43),
  ('luggage_storage',          'Luggage Storage',        'Suitcase',      44),
  ('currency_exchange',        'Currency Exchange',       'MoneyBillWave', 45),
  ('concierge',                'Concierge',              'ConciergeBell', 46),
  ('room_service_24h',         '24-Hour Reception',      'ConciergeBell', 47),
  ('kids_club',                'Kids Club',              'Child',         48),
  ('baby_crib',                'Baby Crib',              'Baby',          49),
  ('stroller',                 'Stroller',               'Child',         50),
  ('family_room',              'Family Room',            'Users',         51),
  ('garden',                   'Garden',                 'Tree',          52),
  ('pool_view',                'Pool View',              'SwimmingPool',  53),
  ('sun_terrace',              'Sun Terrace',            'Sun',           54),
  ('security',                 '24-Hour Security',       'ShieldAlt',     55),
  ('cctv',                     'CCTV',                   'Video',         56),
  ('fire_safety',              'Fire Safety',            'Fire',          57),
  ('wheelchair_accessible',    'Wheelchair Accessible',  'AccessibleIcon',58),
  ('wheelchair_accessible_lift','Wheelchair Lift',        'AccessibleIcon',59)
) AS v(facility_key, label, icon, sort)
WHERE NOT EXISTS (
  SELECT 1 FROM property_lifestyle_facilities f
  WHERE f.property_id = 1004 AND f.facility_key = v.facility_key AND f.deleted_at IS NULL
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 1005 asialink by prasanthi - business hotel, Batam
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO property_lifestyle_facilities (property_id, facility_key, label, icon, sort, status, created_at, updated_at)
SELECT 1005, v.facility_key, v.label, v.icon, v.sort, 1, now(), now()
FROM (VALUES
  ('wifi',              'Free WiFi',              'Wifi',          1),
  ('internet',          'High-Speed Internet',    'Globe',         2),
  ('restaurant',        'Restaurant',             'Utensils',      3),
  ('restaurant_chinese','Chinese Restaurant',     'Utensils',      4),
  ('cafe',              'Cafe',                   'Coffee',        5),
  ('breakfast',         'Breakfast Included',     'Coffee',        6),
  ('room_service',      'Room Service',           'ConciergeBell', 7),
  ('gym',               'Fitness Centre',         'Dumbbell',      8),
  ('pool',              'Swimming Pool',          'SwimmingPool',  9),
  ('spa',               'Spa',                    'Spa',           10),
  ('massage',           'Massage',                'HandPaper',     11),
  ('business_center',   'Business Centre',        'Briefcase',     12),
  ('meeting_room',      'Meeting Room',           'Users',         13),
  ('conference_room',   'Conference Room',        'Users',         14),
  ('parking',           'Free Parking',           'Parking',       15),
  ('airport_shuttle',   'Airport Shuttle',        'ShuttleVan',    16),
  ('air_conditioning',  'Air Conditioning',       'Snowflake',     17),
  ('non_smoking_room',  'Non-Smoking Room',       'Ban',           18),
  ('mini_bar',          'Mini Bar',               'GlassCheers',   19),
  ('flat_tv',           'Flat-Screen TV',         'Tv',            20),
  ('coffee_maker',      'Coffee Maker',           'Coffee',        21),
  ('safe',              'In-Room Safe',           'Lock',          22),
  ('hairdryer',         'Hairdryer',              'Wind',          23),
  ('shower',            'Shower',                 'Shower',        24),
  ('laundry',           'Laundry Service',        'Tshirt',        25),
  ('luggage_storage',   'Luggage Storage',        'Suitcase',      26),
  ('currency_exchange', 'Currency Exchange',       'MoneyBillWave', 27),
  ('atm',               'ATM',                    'MoneyBillWave', 28),
  ('concierge',         'Concierge',              'ConciergeBell', 29),
  ('tour_desk',         'Tour Desk',              'MapMarkedAlt',  30),
  ('ticketing',         'Ticket Service',         'TicketAlt',     31),
  ('room_service_24h',  '24-Hour Reception',      'ConciergeBell', 32),
  ('security',          '24-Hour Security',       'ShieldAlt',     33)
) AS v(facility_key, label, icon, sort)
WHERE NOT EXISTS (
  SELECT 1 FROM property_lifestyle_facilities f
  WHERE f.property_id = 1005 AND f.facility_key = v.facility_key AND f.deleted_at IS NULL
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 1006 Rama Beach (slug somnum-chalets) - beachfront chalets, Labuan Bajo
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO property_lifestyle_facilities (property_id, facility_key, label, icon, sort, status, created_at, updated_at)
SELECT 1006, v.facility_key, v.label, v.icon, v.sort, 1, now(), now()
FROM (VALUES
  ('beachfront',        'Beachfront Location',    'UmbrellaBeach', 1),
  ('beach_access',      'Private Beach Access',   'UmbrellaBeach', 2),
  ('sea_view',          'Sea View',               'Water',         3),
  ('mountain_view',     'Mountain View',          'Mountain',      4),
  ('sun_terrace',       'Sun Terrace',            'Sun',           5),
  ('restaurant',        'Restaurant',             'Utensils',      6),
  ('breakfast',         'Breakfast Included',     'Coffee',        7),
  ('room_service',      'Room Service',           'ConciergeBell', 8),
  ('pool',              'Infinity Pool',          'SwimmingPool',  9),
  ('pool_view',         'Pool and Sea View',      'SwimmingPool',  10),
  ('spa',               'Spa',                    'Spa',           11),
  ('massage',           'In-Villa Massage',       'HandPaper',     12),
  ('bbq',               'Private BBQ',            'Fire',          13),
  ('picnic_area',       'Picnic Area',            'Tree',          14),
  ('garden',            'Tropical Garden',        'Tree',          15),
  ('wifi',              'Free WiFi',              'Wifi',          16),
  ('parking',           'Free Parking',           'Parking',       17),
  ('shuttle',           'Shuttle Service',        'ShuttleVan',    18),
  ('tour_desk',         'Tour and Trekking Desk', 'MapMarkedAlt',  19),
  ('ticketing',         'Ticket Service',         'TicketAlt',     20),
  ('air_conditioning',  'Air Conditioning',       'Snowflake',     21),
  ('non_smoking_room',  'Non-Smoking Room',       'Ban',           22),
  ('mini_bar',          'Mini Bar',               'GlassCheers',   23),
  ('coffee_maker',      'Coffee Maker',           'Coffee',        24),
  ('flat_tv',           'Flat-Screen TV',         'Tv',            25),
  ('safe',              'In-Room Safe',           'Lock',          26),
  ('hairdryer',         'Hairdryer',              'Wind',          27),
  ('bathtub',           'Bathtub',                'Bath',          28),
  ('shower',            'Outdoor Shower',         'Shower',        29),
  ('kettle',            'Electric Kettle',        'MugHot',        30),
  ('laundry',           'Laundry Service',        'Tshirt',        31),
  ('luggage_storage',   'Luggage Storage',        'Suitcase',      32),
  ('family_room',       'Family Friendly',        'Users',         33),
  ('kids_club',         'Kids Activities',        'Child',         34),
  ('baby_crib',         'Baby Crib',              'Baby',          35),
  ('concierge',         'Concierge',              'ConciergeBell', 36),
  ('room_service_24h',  '24-Hour Reception',      'ConciergeBell', 37),
  ('security',          '24-Hour Security',       'ShieldAlt',     38),
  ('fire_safety',       'Fire Safety',            'Fire',          39)
) AS v(facility_key, label, icon, sort)
WHERE NOT EXISTS (
  SELECT 1 FROM property_lifestyle_facilities f
  WHERE f.property_id = 1006 AND f.facility_key = v.facility_key AND f.deleted_at IS NULL
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 1001 Bali Bagus Lovina - currently status=0 (inactive) so the booking engine
-- never lists it. Seeded anyway so enabling the property does not show an empty
-- card.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO property_lifestyle_facilities (property_id, facility_key, label, icon, sort, status, created_at, updated_at)
SELECT 1001, v.facility_key, v.label, v.icon, v.sort, 1, now(), now()
FROM (VALUES
  ('pool',             'Swimming Pool',          'SwimmingPool',  1),
  ('beach_access',     'Beach Access',           'UmbrellaBeach', 2),
  ('sea_view',         'Sea View',               'Water',         3),
  ('restaurant',       'Restaurant',             'Utensils',      4),
  ('breakfast',        'Breakfast Included',     'Coffee',        5),
  ('wifi',             'Free WiFi',              'Wifi',          6),
  ('parking',          'Free Parking',           'Parking',       7),
  ('spa',              'Spa',                    'Spa',           8),
  ('air_conditioning', 'Air Conditioning',       'Snowflake',     9),
  ('non_smoking_room', 'Non-Smoking Room',       'Ban',           10),
  ('garden',           'Garden',                 'Tree',          11),
  ('room_service_24h', '24-Hour Reception',      'ConciergeBell', 12),
  ('security',         '24-Hour Security',       'ShieldAlt',     13)
) AS v(facility_key, label, icon, sort)
WHERE NOT EXISTS (
  SELECT 1 FROM property_lifestyle_facilities f
  WHERE f.property_id = 1001 AND f.facility_key = v.facility_key AND f.deleted_at IS NULL
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Terms & conditions + privacy policy. The portal login and register screens link
-- to these (i18n keys terms_condition / privacy_policy), and only property 999 had
-- one placeholder row titled "t&c", so every other property linked to nothing.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO property_lifestyle_terms (property_id, type, title, content, language, sort, status, created_at, updated_at)
SELECT p.id, v.type, v.title, v.content, 'id', v.sort, 1, now(), now()
FROM properties p
CROSS JOIN (VALUES
  ('terms_condition', 'Syarat & Ketentuan',
   '<h2>Syarat & Ketentuan</h2><p>Check-in mulai pukul 14.00 dan check-out pukul 12.00 waktu setempat. Masa inap dihitung per malam.</p><p>Harga yang ditampilkan belum termasuk pajak dan biaya layanan. Pembayaran dilakukan saat check-in.</p><p>Reservasi dapat dibatalkan gratis hingga 3 hari sebelum tanggal check-in. Setelah itu berlaku surcharge pembatalan sesuai kebijakan hotel.</p><p>Jumlah tamu per kamar tidak boleh melebihi batas maksimal yang tercantum pada detail tipe kamar.</p>',
   1),
  ('privacy_policy', 'Kebijakan Privasi',
   '<h2>Kebijakan Privasi</h2><p>Data tamu yang diberikan saat pendaftaran digunakan untuk memproses reservasi dan memenuhi kebutuhan layanan kami.</p><p>Kami tidak menjual dan tidak menyewakan data pribadi Anda kepada pihak ketiga.</p><p>Anda dapat meminta koreksi atau penghapusan data kapan saja melalui halaman profil akun.</p>',
   2)
) AS v(type, title, content, sort)
WHERE p.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM property_lifestyle_terms t
    WHERE t.property_id = p.id AND t.type = v.type AND t.deleted_at IS NULL
  );

COMMIT;

-- Verification:
--   select p.id, p.name, count(f.id) as facilities
--     from properties p
--     left join property_lifestyle_facilities f
--       on f.property_id = p.id and f.deleted_at is null
--    where p.deleted_at is null
--    group by 1,2 order by 1;
--
--   select p.id, p.name, count(t.id) as terms
--     from properties p
--     left join property_lifestyle_terms t
--       on t.property_id = p.id and t.deleted_at is null
--    where p.deleted_at is null
--    group by 1,2 order by 1;
--
-- Then confirm the portal sees them:
--   curl -s http://localhost:3001/middleware/lifestyle/properties | head -c 800
