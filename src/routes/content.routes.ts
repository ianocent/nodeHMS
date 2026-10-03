import { Router } from 'express';
import { ContentController } from '../controllers/content.controller';
import { LifestyleController } from '../controllers/lifestyle.controller';
import { LoyaltyController } from '../controllers/loyalty.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/permission.middleware';
import { makeUpload } from '../utils/upload';

const router = Router();

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

// ── Lifestyle Facility / Terms (Booking Engine Setup, cms.php:1432-1433) ──
// The booking engine pulls both through GET /middleware/lifestyle/properties.
router.get('/content/lifestyle-facility', authMiddleware, requirePermission(1190, 'view'), LifestyleController.facilityList);
router.get('/content/lifestyle-facility/create', authMiddleware, requirePermission(1190, 'add'), LifestyleController.facilityForm);
router.post('/content/lifestyle-facility', authMiddleware, requirePermission(1190, 'add'), LifestyleController.facilityStore);
router.get('/content/lifestyle-facility/:id', authMiddleware, requirePermission(1190, 'view'), LifestyleController.facilityForm);
router.get('/content/lifestyle-facility/:id/update', authMiddleware, requirePermission(1190, 'edit'), LifestyleController.facilityForm);
router.get('/content/lifestyle-facility/:id/edit', authMiddleware, requirePermission(1190, 'edit'), LifestyleController.facilityForm);
router.put('/content/lifestyle-facility/:id', authMiddleware, requirePermission(1190, 'edit'), LifestyleController.facilityUpdate);
// Table-edit posts the edited row to `uri + "/" + id`.
router.post('/content/lifestyle-facility/:id', authMiddleware, requirePermission(1190, 'edit'), LifestyleController.facilityUpdate);
router.delete('/content/lifestyle-facility/:id', authMiddleware, requirePermission(1190, 'delete'), LifestyleController.facilityDestroy);

router.get('/content/lifestyle-terms', authMiddleware, requirePermission(1191, 'view'), LifestyleController.termList);
router.get('/content/lifestyle-terms/create', authMiddleware, requirePermission(1191, 'add'), LifestyleController.termForm);
router.post('/content/lifestyle-terms', authMiddleware, requirePermission(1191, 'add'), LifestyleController.termStore);
router.get('/content/lifestyle-terms/:id', authMiddleware, requirePermission(1191, 'view'), LifestyleController.termForm);
router.get('/content/lifestyle-terms/:id/update', authMiddleware, requirePermission(1191, 'edit'), LifestyleController.termForm);
router.get('/content/lifestyle-terms/:id/edit', authMiddleware, requirePermission(1191, 'edit'), LifestyleController.termForm);
router.put('/content/lifestyle-terms/:id', authMiddleware, requirePermission(1191, 'edit'), LifestyleController.termUpdate);
router.post('/content/lifestyle-terms/:id', authMiddleware, requirePermission(1191, 'edit'), LifestyleController.termUpdate);
router.delete('/content/lifestyle-terms/:id', authMiddleware, requirePermission(1191, 'delete'), LifestyleController.termDestroy);

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
