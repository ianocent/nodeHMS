import { Router } from 'express';
import { ContentController } from '../controllers/content.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/permission.middleware';

const router = Router();

// ── Content / SEO / Room / Config-Pax (contents model) ──
router.get('/content/content-list', authMiddleware, requirePermission(69, 'view'), ContentController.contentList);
router.get('/content/content-list/create', authMiddleware, requirePermission(69, 'add'), ContentController.contentForm);
router.post('/content/content-list', authMiddleware, requirePermission(69, 'add'), ContentController.contentStore);
router.get('/content/content-list/:id', authMiddleware, requirePermission(69, 'view'), ContentController.contentForm);
router.get('/content/content-list/:id/update', authMiddleware, requirePermission(69, 'edit'), ContentController.contentForm);
router.put('/content/content-list/:id', authMiddleware, requirePermission(69, 'edit'), ContentController.contentUpdate);
router.delete('/content/content-list/:id', authMiddleware, requirePermission(69, 'delete'), ContentController.contentDestroy);

router.get('/content/seo-home', authMiddleware, requirePermission(69, 'view'), (req, res) => { req.query.keyword = 'seo-home'; ContentController.contentList(req, res); });
router.get('/content/room', authMiddleware, requirePermission(69, 'view'), (req, res) => { req.query.keyword = 'room'; ContentController.contentList(req, res); });
router.get('/content/room/config-pax', authMiddleware, requirePermission(69, 'view'), (req, res) => { req.query.keyword = 'config-pax'; ContentController.contentList(req, res); });

// ── Banner (content_banners model) ──
router.get('/content/banner', authMiddleware, requirePermission(69, 'view'), ContentController.bannerList);
router.get('/content/banner/create', authMiddleware, requirePermission(69, 'add'), ContentController.bannerForm);
router.post('/content/banner', authMiddleware, requirePermission(69, 'add'), ContentController.bannerStore);
router.get('/content/banner/:id', authMiddleware, requirePermission(69, 'view'), ContentController.bannerForm);
router.get('/content/banner/:id/update', authMiddleware, requirePermission(69, 'edit'), ContentController.bannerForm);
router.put('/content/banner/:id', authMiddleware, requirePermission(69, 'edit'), ContentController.bannerUpdate);
router.delete('/content/banner/:id', authMiddleware, requirePermission(69, 'delete'), ContentController.bannerDestroy);

// ── Cancelation Rule (cancelation_rules model) ──
router.get('/cancelation-rule', authMiddleware, requirePermission(69, 'view'), ContentController.cancelationRuleList);
router.get('/cancelation-rule/create', authMiddleware, requirePermission(69, 'add'), ContentController.cancelationRuleForm);
router.post('/cancelation-rule', authMiddleware, requirePermission(69, 'add'), ContentController.cancelationRuleStore);
router.get('/cancelation-rule/:id', authMiddleware, requirePermission(69, 'view'), ContentController.cancelationRuleForm);
router.get('/cancelation-rule/:id/update', authMiddleware, requirePermission(69, 'edit'), ContentController.cancelationRuleForm);
router.put('/cancelation-rule/:id', authMiddleware, requirePermission(69, 'edit'), ContentController.cancelationRuleUpdate);
router.delete('/cancelation-rule/:id', authMiddleware, requirePermission(69, 'delete'), ContentController.cancelationRuleDestroy);

// ── Cancelation Rule Date (cancelation_rule_dates model) ──
router.get('/cancelation-rule-date', authMiddleware, requirePermission(69, 'view'), ContentController.cancelationRuleDateList);
router.get('/cancelation-rule-date/create', authMiddleware, requirePermission(69, 'add'), ContentController.cancelationRuleForm);
router.post('/cancelation-rule-date', authMiddleware, requirePermission(69, 'add'), ContentController.cancelationRuleDateStore);
router.get('/cancelation-rule-date/:id', authMiddleware, requirePermission(69, 'view'), ContentController.cancelationRuleForm);
router.get('/cancelation-rule-date/:id/update', authMiddleware, requirePermission(69, 'edit'), ContentController.cancelationRuleForm);
router.put('/cancelation-rule-date/:id', authMiddleware, requirePermission(69, 'edit'), ContentController.cancelationRuleDateUpdate);
router.delete('/cancelation-rule-date/:id', authMiddleware, requirePermission(69, 'delete'), ContentController.cancelationRuleDateDestroy);

// ── Email Builder (email_builders model) ──
router.get('/email/email-builder', authMiddleware, requirePermission(69, 'view'), ContentController.emailBuilderList);
router.get('/email/email-builder/create', authMiddleware, requirePermission(69, 'add'), ContentController.emailBuilderForm);
router.post('/email/email-builder', authMiddleware, requirePermission(69, 'add'), ContentController.emailBuilderStore);
router.get('/email/email-builder/:id', authMiddleware, requirePermission(69, 'view'), ContentController.emailBuilderForm);
router.get('/email/email-builder/:id/update', authMiddleware, requirePermission(69, 'edit'), ContentController.emailBuilderForm);
router.put('/email/email-builder/:id', authMiddleware, requirePermission(69, 'edit'), ContentController.emailBuilderUpdate);
router.delete('/email/email-builder/:id', authMiddleware, requirePermission(69, 'delete'), ContentController.emailBuilderDestroy);

// ── Email Group (email_groups model) ──
router.get('/email/email-group', authMiddleware, requirePermission(69, 'view'), ContentController.emailGroupList);
router.get('/email/email-group/create', authMiddleware, requirePermission(69, 'add'), ContentController.emailGroupForm);
router.post('/email/email-group', authMiddleware, requirePermission(69, 'add'), ContentController.emailGroupStore);
router.get('/email/email-group/:id', authMiddleware, requirePermission(69, 'view'), ContentController.emailGroupForm);
router.get('/email/email-group/:id/update', authMiddleware, requirePermission(69, 'edit'), ContentController.emailGroupForm);
router.put('/email/email-group/:id', authMiddleware, requirePermission(69, 'edit'), ContentController.emailGroupUpdate);
router.delete('/email/email-group/:id', authMiddleware, requirePermission(69, 'delete'), ContentController.emailGroupDestroy);

// ── Email Send Master (email-send page) ──
router.get('/email/email-send/master', authMiddleware, requirePermission(69, 'view'), ContentController.emailSendMaster);

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
