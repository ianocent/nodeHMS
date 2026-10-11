import { Router } from 'express';
import { ContentController } from '../controllers/content.controller';
import { ContentRoomController } from '../controllers/content-room.controller';
import { LoyaltyFacilityController } from '../controllers/loyalty-facility.controller';
import { LoyaltyController } from '../controllers/loyalty.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/permission.middleware';
import { makeUpload } from '../utils/upload';

const router = Router();

// Room image / facility forms post the picture as multipart/form-data, so multer has
// to run before the controller: express.json() leaves `req.body` undefined otherwise.
// 2 MB for photos, 1 MB for facility glyphs — both mirror Laravel's `max:2048` on the
// equivalent reference routes, and the facility file is a small icon by nature.
const roomImageUpload = makeUpload(['jpeg', 'png', 'jpg', 'gif', 'webp'], 2);
const roomFacilityUpload = makeUpload(['jpeg', 'png', 'jpg', 'gif', 'webp'], 1);

// ── Content / SEO / Room / Config-Pax (contents model) ──
router.get('/content/content-list', authMiddleware, requirePermission(69, 'view'), ContentController.contentList);
router.get('/content/content-list/create', authMiddleware, requirePermission(69, 'add'), ContentController.contentForm);
router.post('/content/content-list', authMiddleware, requirePermission(69, 'add'), ContentController.contentStore);
router.get('/content/content-list/:id', authMiddleware, requirePermission(69, 'view'), ContentController.contentForm);
router.get('/content/content-list/:id/update', authMiddleware, requirePermission(69, 'edit'), ContentController.contentForm);
router.get('/content/content-list/:id/edit', authMiddleware, requirePermission(69, 'edit'), ContentController.contentForm);
router.put('/content/content-list/:id', authMiddleware, requirePermission(69, 'edit'), ContentController.contentUpdate);
router.delete('/content/content-list/:id', authMiddleware, requirePermission(69, 'delete'), ContentController.contentDestroy);

router.get('/content/seo-home', authMiddleware, requirePermission(69, 'view'), (req, res) => { req.query.keyword = 'seo-home'; ContentController.contentList(req, res); });
router.get('/content/room', authMiddleware, requirePermission(69, 'view'), (req, res) => { req.query.keyword = 'room'; ContentController.contentList(req, res); });
router.get('/content/room/config-pax', authMiddleware, requirePermission(69, 'view'), (req, res) => { req.query.keyword = 'config-pax'; ContentController.contentList(req, res); });

// ── Content keyword suffix routes (seo-home / room / config-pax) ──
router.get('/content/seo-home/create', authMiddleware, requirePermission(69, 'add'), ContentController.contentForm);
router.get('/content/seo-home/:id', authMiddleware, requirePermission(69, 'view'), ContentController.contentForm);
router.get('/content/seo-home/:id/update', authMiddleware, requirePermission(69, 'edit'), ContentController.contentForm);
router.get('/content/seo-home/:id/edit', authMiddleware, requirePermission(69, 'edit'), ContentController.contentForm);
router.post('/content/seo-home', authMiddleware, requirePermission(69, 'add'), ContentController.contentStore);
router.put('/content/seo-home/:id', authMiddleware, requirePermission(69, 'edit'), ContentController.contentUpdate);
router.delete('/content/seo-home/:id', authMiddleware, requirePermission(69, 'delete'), ContentController.contentDestroy);

// ── Room Config Facility (content_room_facilities) ──
// Scoped to a room TYPE, not a physical room: the booking engine reads these per
// room_type_id (RoomType::getFacilitiesAttribute), so `?room_type_id=N` is required on
// the list. Menu 1120 (Master Setup > Room Type) gates them, matching room.routes.ts.
//
// REGISTERED BEFORE `/content/room/:id` on purpose. Express matches in registration
// order, so `GET /content/room/config-facility` used to fall into the `:id` route with
// id="config-facility", ContentController.contentForm answered `data: {status: 1}` (its
// no-id branch) instead of the row list, and the frontend crashed on `.map` of a
// non-array. Same trap as `/content/room/config-pax`, which is why that one already
// sits above its `:id` sibling. Any literal segment added under `/content/room/` has to
// go above this block.
router.get('/content/room/config-facility', authMiddleware, requirePermission(1120, 'view'), ContentRoomController.facilityList);
router.get('/content/room/config-facility/create', authMiddleware, requirePermission(1120, 'add'), ContentRoomController.facilityForm);
router.post('/content/room/config-facility', authMiddleware, requirePermission(1120, 'add'), roomFacilityUpload.single('image'), ContentRoomController.facilityStore);
router.get('/content/room/config-facility/:id', authMiddleware, requirePermission(1120, 'view'), ContentRoomController.facilityForm);
router.get('/content/room/config-facility/:id/update', authMiddleware, requirePermission(1120, 'edit'), ContentRoomController.facilityForm);
router.get('/content/room/config-facility/:id/edit', authMiddleware, requirePermission(1120, 'edit'), ContentRoomController.facilityForm);
router.put('/content/room/config-facility/:id', authMiddleware, requirePermission(1120, 'edit'), roomFacilityUpload.single('image'), ContentRoomController.facilityUpdate);
// Table edit posts the edited row to `uri + "/" + id`, so POST must behave like PUT.
router.post('/content/room/config-facility/:id', authMiddleware, requirePermission(1120, 'edit'), roomFacilityUpload.single('image'), ContentRoomController.facilityUpdate);
router.delete('/content/room/config-facility/:id', authMiddleware, requirePermission(1120, 'delete'), ContentRoomController.facilityDestroy);

// ── Room Config Image (content_room_images) ──
// Same ordering rule as config-facility above: must precede `/content/room/:id`.
router.get('/content/room/config-image', authMiddleware, requirePermission(1120, 'view'), ContentRoomController.imageList);
router.get('/content/room/config-image/create', authMiddleware, requirePermission(1120, 'add'), ContentRoomController.imageForm);
router.post('/content/room/config-image', authMiddleware, requirePermission(1120, 'add'), roomImageUpload.single('image'), ContentRoomController.imageStore);
router.get('/content/room/config-image/:id', authMiddleware, requirePermission(1120, 'view'), ContentRoomController.imageForm);
router.get('/content/room/config-image/:id/update', authMiddleware, requirePermission(1120, 'edit'), ContentRoomController.imageForm);
router.get('/content/room/config-image/:id/edit', authMiddleware, requirePermission(1120, 'edit'), ContentRoomController.imageForm);
router.put('/content/room/config-image/:id', authMiddleware, requirePermission(1120, 'edit'), roomImageUpload.single('image'), ContentRoomController.imageUpdate);
router.post('/content/room/config-image/:id', authMiddleware, requirePermission(1120, 'edit'), roomImageUpload.single('image'), ContentRoomController.imageUpdate);
router.delete('/content/room/config-image/:id', authMiddleware, requirePermission(1120, 'delete'), ContentRoomController.imageDestroy);

router.get('/content/room/create', authMiddleware, requirePermission(69, 'add'), ContentController.contentForm);
router.get('/content/room/:id', authMiddleware, requirePermission(69, 'view'), ContentController.contentForm);
router.get('/content/room/:id/update', authMiddleware, requirePermission(69, 'edit'), ContentController.contentForm);
router.get('/content/room/:id/edit', authMiddleware, requirePermission(69, 'edit'), ContentController.contentForm);
router.post('/content/room', authMiddleware, requirePermission(69, 'add'), ContentController.contentStore);
router.put('/content/room/:id', authMiddleware, requirePermission(69, 'edit'), ContentController.contentUpdate);
router.delete('/content/room/:id', authMiddleware, requirePermission(69, 'delete'), ContentController.contentDestroy);

router.get('/content/room/config-pax/create', authMiddleware, requirePermission(69, 'add'), ContentController.contentForm);
router.get('/content/room/config-pax/:id', authMiddleware, requirePermission(69, 'view'), ContentController.contentForm);
router.get('/content/room/config-pax/:id/update', authMiddleware, requirePermission(69, 'edit'), ContentController.contentForm);
router.get('/content/room/config-pax/:id/edit', authMiddleware, requirePermission(69, 'edit'), ContentController.contentForm);
router.post('/content/room/config-pax', authMiddleware, requirePermission(69, 'add'), ContentController.contentStore);
router.put('/content/room/config-pax/:id', authMiddleware, requirePermission(69, 'edit'), ContentController.contentUpdate);
router.delete('/content/room/config-pax/:id', authMiddleware, requirePermission(69, 'delete'), ContentController.contentDestroy);


// ── Banner (content_banners model) ──
// The banner form posts multipart/form-data (name + image File + ...), so multer has
// to run before the controller: express.json() leaves `req.body` undefined otherwise.
// Validation mirrors Laravel `image|mimes:jpeg,png,jpg,gif|max:2048`.
const bannerUpload = makeUpload(['jpeg', 'png', 'jpg', 'gif'], 2);
router.get('/content/banner', authMiddleware, requirePermission(69, 'view'), ContentController.bannerList);
router.get('/content/banner/create', authMiddleware, requirePermission(69, 'add'), ContentController.bannerForm);
router.post('/content/banner', authMiddleware, requirePermission(69, 'add'), bannerUpload.single('image'), ContentController.bannerStore);
router.get('/content/banner/:id', authMiddleware, requirePermission(69, 'view'), ContentController.bannerForm);
router.get('/content/banner/:id/update', authMiddleware, requirePermission(69, 'edit'), ContentController.bannerForm);
router.get('/content/banner/:id/edit', authMiddleware, requirePermission(69, 'edit'), ContentController.bannerForm);
router.put('/content/banner/:id', authMiddleware, requirePermission(69, 'edit'), ContentController.bannerUpdate);
// Laravel routes/cms.php:1430 `Route::post('banner/{banner}', [ContentBannerController::class, 'update'])`
// inside the content prefix - the banner form always POSTs to GLOBALURI + "/" + id.
router.post('/content/banner/:id', authMiddleware, requirePermission(69, 'edit'), bannerUpload.single('image'), ContentController.bannerUpdate);
router.delete('/content/banner/:id', authMiddleware, requirePermission(69, 'delete'), ContentController.bannerDestroy);

// ── Loyalty Reward (Booking Engine MySQL `loyalty_rewards`, cms.php:1434) ──
// The guest portal reads this catalog through RewardController@rewards, so the CRUD
// here writes straight into the booking engine database.
router.get('/content/loyalty-reward', authMiddleware, requirePermission(1192, 'view'), LoyaltyController.rewardList);
router.get('/content/loyalty-reward/create', authMiddleware, requirePermission(1192, 'add'), LoyaltyController.rewardForm);
router.post('/content/loyalty-reward', authMiddleware, requirePermission(1192, 'add'), LoyaltyController.rewardStore);
router.get('/content/loyalty-reward/:id', authMiddleware, requirePermission(1192, 'view'), LoyaltyController.rewardForm);
router.get('/content/loyalty-reward/:id/update', authMiddleware, requirePermission(1192, 'edit'), LoyaltyController.rewardForm);
router.get('/content/loyalty-reward/:id/edit', authMiddleware, requirePermission(1192, 'edit'), LoyaltyController.rewardForm);
router.put('/content/loyalty-reward/:id', authMiddleware, requirePermission(1192, 'edit'), LoyaltyController.rewardUpdate);
router.post('/content/loyalty-reward/:id', authMiddleware, requirePermission(1192, 'edit'), LoyaltyController.rewardUpdate);
router.delete('/content/loyalty-reward/:id', authMiddleware, requirePermission(1192, 'delete'), LoyaltyController.rewardDestroy);

// ── Reward Redemption (Booking Engine MySQL `reward_redemptions`, cms.php:1435) ──
// Read + status only: rows are created by the guest portal, never from HMS.
router.get('/content/reward-redemption', authMiddleware, requirePermission(1193, 'view'), LoyaltyController.redemptionList);
router.post('/content/reward-redemption', authMiddleware, requirePermission(1193, 'add'), LoyaltyController.redemptionCreate);
router.get('/content/reward-redemption/:id', authMiddleware, requirePermission(1193, 'view'), LoyaltyController.redemptionShow);
router.get('/content/reward-redemption/:id/update', authMiddleware, requirePermission(1193, 'edit'), LoyaltyController.redemptionEdit);
router.get('/content/reward-redemption/:id/edit', authMiddleware, requirePermission(1193, 'edit'), LoyaltyController.redemptionEdit);
router.put('/content/reward-redemption/:id', authMiddleware, requirePermission(1193, 'edit'), LoyaltyController.redemptionUpdate);
router.post('/content/reward-redemption/:id', authMiddleware, requirePermission(1193, 'edit'), LoyaltyController.redemptionUpdate);
router.delete('/content/reward-redemption/:id', authMiddleware, requirePermission(1193, 'delete'), LoyaltyController.redemptionDestroy);

// ── Guest Point Transaction (Booking Engine MySQL, cms.php:1436) ──
// Fully read-only: the ledger is written by the booking engine on every stay.
router.get('/content/guest-point-transaction', authMiddleware, requirePermission(1194, 'view'), LoyaltyController.pointList);
router.post('/content/guest-point-transaction', authMiddleware, requirePermission(1194, 'add'), LoyaltyController.pointCreate);
router.get('/content/guest-point-transaction/:id', authMiddleware, requirePermission(1194, 'view'), LoyaltyController.pointShow);
router.get('/content/guest-point-transaction/:id/update', authMiddleware, requirePermission(1194, 'edit'), LoyaltyController.pointShow);
router.get('/content/guest-point-transaction/:id/edit', authMiddleware, requirePermission(1194, 'edit'), LoyaltyController.pointShow);
router.put('/content/guest-point-transaction/:id', authMiddleware, requirePermission(1194, 'edit'), LoyaltyController.pointUpdate);
router.post('/content/guest-point-transaction/:id', authMiddleware, requirePermission(1194, 'edit'), LoyaltyController.pointUpdate);
router.delete('/content/guest-point-transaction/:id', authMiddleware, requirePermission(1194, 'delete'), LoyaltyController.pointDestroy);

// ── Loyalty Facility / Terms (Booking Engine Setup, cms.php:1432-1433) ──
// The booking engine pulls both through GET /middleware/loyalty/properties.
//
// The `lifestyle-*` paths stay registered as aliases. A menu row, a bookmark or a
// saved `menus.url` can still carry the old slug, and a rename that 404s those is worse
// than one that answers. Delete them once no database row points at the old path.
router.get('/content/loyalty-facility', authMiddleware, requirePermission(1190, 'view'), LoyaltyFacilityController.facilityList);
router.get('/content/loyalty-facility/create', authMiddleware, requirePermission(1190, 'add'), LoyaltyFacilityController.facilityForm);
router.post('/content/loyalty-facility', authMiddleware, requirePermission(1190, 'add'), LoyaltyFacilityController.facilityStore);
router.get('/content/loyalty-facility/:id', authMiddleware, requirePermission(1190, 'view'), LoyaltyFacilityController.facilityForm);
router.get('/content/loyalty-facility/:id/update', authMiddleware, requirePermission(1190, 'edit'), LoyaltyFacilityController.facilityForm);
router.get('/content/loyalty-facility/:id/edit', authMiddleware, requirePermission(1190, 'edit'), LoyaltyFacilityController.facilityForm);
router.put('/content/loyalty-facility/:id', authMiddleware, requirePermission(1190, 'edit'), LoyaltyFacilityController.facilityUpdate);
// Table-edit posts the edited row to `uri + "/" + id`.
router.post('/content/loyalty-facility/:id', authMiddleware, requirePermission(1190, 'edit'), LoyaltyFacilityController.facilityUpdate);
router.delete('/content/loyalty-facility/:id', authMiddleware, requirePermission(1190, 'delete'), LoyaltyFacilityController.facilityDestroy);

router.get('/content/loyalty-terms', authMiddleware, requirePermission(1191, 'view'), LoyaltyFacilityController.termList);
router.get('/content/loyalty-terms/create', authMiddleware, requirePermission(1191, 'add'), LoyaltyFacilityController.termForm);
router.post('/content/loyalty-terms', authMiddleware, requirePermission(1191, 'add'), LoyaltyFacilityController.termStore);
router.get('/content/loyalty-terms/:id', authMiddleware, requirePermission(1191, 'view'), LoyaltyFacilityController.termForm);
router.get('/content/loyalty-terms/:id/update', authMiddleware, requirePermission(1191, 'edit'), LoyaltyFacilityController.termForm);
router.get('/content/loyalty-terms/:id/edit', authMiddleware, requirePermission(1191, 'edit'), LoyaltyFacilityController.termForm);
router.put('/content/loyalty-terms/:id', authMiddleware, requirePermission(1191, 'edit'), LoyaltyFacilityController.termUpdate);
router.post('/content/loyalty-terms/:id', authMiddleware, requirePermission(1191, 'edit'), LoyaltyFacilityController.termUpdate);
router.delete('/content/loyalty-terms/:id', authMiddleware, requirePermission(1191, 'delete'), LoyaltyFacilityController.termDestroy);

// Deprecated aliases -> the handlers above. Same middleware, same permission id.
router.get('/content/lifestyle-facility', authMiddleware, requirePermission(1190, 'view'), LoyaltyFacilityController.facilityList);
router.get('/content/lifestyle-facility/create', authMiddleware, requirePermission(1190, 'add'), LoyaltyFacilityController.facilityForm);
router.post('/content/lifestyle-facility', authMiddleware, requirePermission(1190, 'add'), LoyaltyFacilityController.facilityStore);
router.get('/content/lifestyle-facility/:id', authMiddleware, requirePermission(1190, 'view'), LoyaltyFacilityController.facilityForm);
router.get('/content/lifestyle-facility/:id/update', authMiddleware, requirePermission(1190, 'edit'), LoyaltyFacilityController.facilityForm);
router.get('/content/lifestyle-facility/:id/edit', authMiddleware, requirePermission(1190, 'edit'), LoyaltyFacilityController.facilityForm);
router.put('/content/lifestyle-facility/:id', authMiddleware, requirePermission(1190, 'edit'), LoyaltyFacilityController.facilityUpdate);
router.post('/content/lifestyle-facility/:id', authMiddleware, requirePermission(1190, 'edit'), LoyaltyFacilityController.facilityUpdate);
router.delete('/content/lifestyle-facility/:id', authMiddleware, requirePermission(1190, 'delete'), LoyaltyFacilityController.facilityDestroy);

router.get('/content/lifestyle-terms', authMiddleware, requirePermission(1191, 'view'), LoyaltyFacilityController.termList);
router.get('/content/lifestyle-terms/create', authMiddleware, requirePermission(1191, 'add'), LoyaltyFacilityController.termForm);
router.post('/content/lifestyle-terms', authMiddleware, requirePermission(1191, 'add'), LoyaltyFacilityController.termStore);
router.get('/content/lifestyle-terms/:id', authMiddleware, requirePermission(1191, 'view'), LoyaltyFacilityController.termForm);
router.get('/content/lifestyle-terms/:id/update', authMiddleware, requirePermission(1191, 'edit'), LoyaltyFacilityController.termForm);
router.get('/content/lifestyle-terms/:id/edit', authMiddleware, requirePermission(1191, 'edit'), LoyaltyFacilityController.termForm);
router.put('/content/lifestyle-terms/:id', authMiddleware, requirePermission(1191, 'edit'), LoyaltyFacilityController.termUpdate);
router.post('/content/lifestyle-terms/:id', authMiddleware, requirePermission(1191, 'edit'), LoyaltyFacilityController.termUpdate);
router.delete('/content/lifestyle-terms/:id', authMiddleware, requirePermission(1191, 'delete'), LoyaltyFacilityController.termDestroy);

// ── Cancelation Rule (cancelation_rules model) ──
router.get('/cancelation-rule', authMiddleware, requirePermission(69, 'view'), ContentController.cancelationRuleList);
router.get('/cancelation-rule/create', authMiddleware, requirePermission(69, 'add'), ContentController.cancelationRuleForm);
router.post('/cancelation-rule', authMiddleware, requirePermission(69, 'add'), ContentController.cancelationRuleStore);
router.get('/cancelation-rule/:id', authMiddleware, requirePermission(69, 'view'), ContentController.cancelationRuleForm);
router.get('/cancelation-rule/:id/update', authMiddleware, requirePermission(69, 'edit'), ContentController.cancelationRuleForm);
router.get('/cancelation-rule/:id/edit', authMiddleware, requirePermission(69, 'edit'), ContentController.cancelationRuleForm);
router.put('/cancelation-rule/:id', authMiddleware, requirePermission(69, 'edit'), ContentController.cancelationRuleUpdate);
router.delete('/cancelation-rule/:id', authMiddleware, requirePermission(69, 'delete'), ContentController.cancelationRuleDestroy);

// ── Cancelation Rule Date (cancelation_rule_dates model) ──
router.get('/cancelation-rule-date', authMiddleware, requirePermission(69, 'view'), ContentController.cancelationRuleDateList);
router.get('/cancelation-rule-date/create', authMiddleware, requirePermission(69, 'add'), ContentController.cancelationRuleForm);
router.post('/cancelation-rule-date', authMiddleware, requirePermission(69, 'add'), ContentController.cancelationRuleDateStore);
router.get('/cancelation-rule-date/:id', authMiddleware, requirePermission(69, 'view'), ContentController.cancelationRuleForm);
router.get('/cancelation-rule-date/:id/update', authMiddleware, requirePermission(69, 'edit'), ContentController.cancelationRuleForm);
router.get('/cancelation-rule-date/:id/edit', authMiddleware, requirePermission(69, 'edit'), ContentController.cancelationRuleForm);
router.put('/cancelation-rule-date/:id', authMiddleware, requirePermission(69, 'edit'), ContentController.cancelationRuleDateUpdate);
router.delete('/cancelation-rule-date/:id', authMiddleware, requirePermission(69, 'delete'), ContentController.cancelationRuleDateDestroy);

// ── Email Builder (email_builders model) ──
router.get('/email/email-builder', authMiddleware, requirePermission(69, 'view'), ContentController.emailBuilderList);
router.get('/email/email-builder/create', authMiddleware, requirePermission(69, 'add'), ContentController.emailBuilderForm);
router.post('/email/email-builder', authMiddleware, requirePermission(69, 'add'), ContentController.emailBuilderStore);
router.get('/email/email-builder/:id', authMiddleware, requirePermission(69, 'view'), ContentController.emailBuilderForm);
router.get('/email/email-builder/:id/update', authMiddleware, requirePermission(69, 'edit'), ContentController.emailBuilderForm);
router.get('/email/email-builder/:id/edit', authMiddleware, requirePermission(69, 'edit'), ContentController.emailBuilderForm);
router.put('/email/email-builder/:id', authMiddleware, requirePermission(69, 'edit'), ContentController.emailBuilderUpdate);
router.delete('/email/email-builder/:id', authMiddleware, requirePermission(69, 'delete'), ContentController.emailBuilderDestroy);

// ── Email Group (email_groups model) ──
router.get('/email/email-group', authMiddleware, requirePermission(69, 'view'), ContentController.emailGroupList);
router.get('/email/email-group/create', authMiddleware, requirePermission(69, 'add'), ContentController.emailGroupForm);
router.post('/email/email-group', authMiddleware, requirePermission(69, 'add'), ContentController.emailGroupStore);
router.get('/email/email-group/:id', authMiddleware, requirePermission(69, 'view'), ContentController.emailGroupForm);
router.get('/email/email-group/:id/update', authMiddleware, requirePermission(69, 'edit'), ContentController.emailGroupForm);
router.get('/email/email-group/:id/edit', authMiddleware, requirePermission(69, 'edit'), ContentController.emailGroupForm);
router.put('/email/email-group/:id', authMiddleware, requirePermission(69, 'edit'), ContentController.emailGroupUpdate);
router.delete('/email/email-group/:id', authMiddleware, requirePermission(69, 'delete'), ContentController.emailGroupDestroy);

// ── Email Send Master (email-send page) ──
router.get('/email/email-send/master', authMiddleware, requirePermission(69, 'view'), ContentController.emailSendMaster);

// ── Send Email (EmailGroupController@sendEmail parity) ──
router.post('/email/send-mail', authMiddleware, requirePermission(69, 'add'), ContentController.sendEmail);

// ── Send Email Per Template (parity EmailGroupController@sendEmailPerTemplate) ──
router.get('/email/send-mail-template/:template', authMiddleware, requirePermission(69, 'view'), ContentController.sendMailTemplate);

// ── Other Guest (other_guests model) ──
router.get('/other-guest', authMiddleware, requirePermission(69, 'view'), ContentController.otherGuestList);
router.post('/other-guest', authMiddleware, requirePermission(69, 'add'), ContentController.otherGuestStore);
router.put('/other-guest/:id', authMiddleware, requirePermission(69, 'edit'), ContentController.otherGuestUpdate);
router.delete('/other-guest/:id', authMiddleware, requirePermission(69, 'delete'), ContentController.otherGuestDestroy);

// ── Room Inventory / Room Reservation lists ──
router.get('/room-inventory', authMiddleware, requirePermission(1120, 'view'), ContentController.roomInventoryList);
router.get('/room-reservation', authMiddleware, requirePermission(1120, 'view'), ContentController.roomReservationList);

export default router;
