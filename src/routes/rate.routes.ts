import { Router } from 'express';
import { RateController } from '../controllers/rate.controller';
import { DynamicRateController } from '../controllers/dynamic-rate.controller';
import { PromotionController } from '../controllers/promotion.controller';
import { RateAddonController } from '../controllers/rate-addon.controller';
import { CompanyContractRateController } from '../controllers/company-contract-rate.controller';
import { ReservationController } from '../controllers/reservation.controller';
import { BarController } from '../controllers/bar.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/permission.middleware';

const router = Router();

// ═══════════════════════════════════════════════
// Phase 4.3 — Pricing & Rate Management
// ═══════════════════════════════════════════════

// ── Rate CRUD (menuId: 86) ──
router.get('/rates', authMiddleware, requirePermission(86, 'view'), RateController.list);
router.get('/rates/create', authMiddleware, requirePermission(86, 'add'), RateController.create);
router.post('/rates', authMiddleware, requirePermission(86, 'add'), RateController.store);
router.get('/rates/:id', authMiddleware, requirePermission(86, 'view'), RateController.show);
router.get('/rates/:id/edit', authMiddleware, requirePermission(86, 'edit'), RateController.edit);
router.put('/rates/:id', authMiddleware, requirePermission(86, 'edit'), RateController.update);
router.delete('/rates/:id', authMiddleware, requirePermission(86, 'delete'), RateController.destroy);
router.post('/rates/:id/restore', authMiddleware, requirePermission(86, 'edit'), RateController.restore);

// Singular aliases for frontend compatibility
router.get('/rate', authMiddleware, requirePermission(86, 'view'), RateController.list);
router.get('/rate/create', authMiddleware, requirePermission(86, 'add'), RateController.create);
router.post('/rate', authMiddleware, requirePermission(86, 'add'), RateController.store);

// Rate inclusives / extra beds (frontend sends rate_id as query param; must precede /rate/:id)
router.get('/rate/inclusives', authMiddleware, requirePermission(86, 'view'), (req, res) => {
  req.params.rateId = String(req.query.rate_id ?? '');
  RateAddonController.inclusiveList(req, res);
});
router.post('/rate/inclusives', authMiddleware, requirePermission(86, 'add'), (req, res) => {
  req.params.rateId = String(req.query.rate_id ?? '');
  RateAddonController.inclusiveStore(req, res);
});
router.get('/rate/extra-beds', authMiddleware, requirePermission(86, 'view'), (req, res) => {
  req.params.rateId = String(req.query.rate_id ?? '');
  RateAddonController.extraBedList(req, res);
});
router.post('/rate/extra-beds', authMiddleware, requirePermission(86, 'add'), (req, res) => {
  req.params.rateId = String(req.query.rate_id ?? '');
  RateAddonController.extraBedStore(req, res);
});

// ── /rate/rate — rate-rate/form grid page (must precede /rate/:id) ──
function gridQuery(req: any) {
  const b = req.body || {};
  for (const k of ['start_date', 'end_date']) {
    if (req.query[k] === undefined && b[k] !== undefined) req.query[k] = b[k];
  }
  for (const k of Object.keys(b)) {
    if ((k.startsWith('days_') || k.startsWith('room_type_') || k.startsWith('fields_')) && req.query[k] === undefined) req.query[k] = b[k];
  }
}
function rateIdFromQuery(req: any): string {
  return String(req.query.rate_id ?? req.query.id ?? req.query.bar_id ?? '');
}
router.get('/rate/rate', authMiddleware, requirePermission(86, 'view'), (req, res) => {
  req.params.rateId = rateIdFromQuery(req);
  return RateController.rateGrid(req, res);
});
router.post('/rate/rate', authMiddleware, requirePermission(86, 'view'), (req, res) => {
  gridQuery(req);
  req.params.rateId = rateIdFromQuery(req);
  return RateController.rateGrid(req, res);
});
router.get('/rate/rate/create', authMiddleware, requirePermission(86, 'add'), RateController.create);
router.post('/rate/rate/store', authMiddleware, requirePermission(86, 'add'), (req, res) => {
  if (req.body.rate_id === undefined && req.body.bar_id !== undefined) req.body.rate_id = req.body.bar_id;
  return RateController.barRateStore(req, res);
});
router.put('/rate/rate/:id', authMiddleware, requirePermission(86, 'edit'), (req, res) => {
  if (req.body.rate_id === undefined) req.body.rate_id = req.params.id;
  return RateController.barRateUpdate(req, res);
});
router.get('/rate/rate/:id/update', authMiddleware, requirePermission(86, 'edit'), RateController.create);

// ── /rate/rate-link-listing — RateRelationController parity (must precede /rate/:id) ──
router.get('/rate/rate-link-listing', authMiddleware, requirePermission(86, 'view'), RateController.rateLinkListing);
router.post('/rate/rate-link-listing', authMiddleware, requirePermission(86, 'edit'), RateController.rateLinkStore);
router.put('/rate/rate-link-listing/:id', authMiddleware, requirePermission(86, 'edit'), RateController.rateLinkUpdate);
router.get('/rate/rate-link-listing/apply', authMiddleware, requirePermission(86, 'view'), RateController.rateLinkApplyList);
router.post('/rate/rate-link-listing/apply', authMiddleware, requirePermission(86, 'edit'), RateController.rateLinkApply);

// ── /rate/company-applicable — RateRelationController::company parity ──
router.get('/rate/company-applicable', authMiddleware, requirePermission(86, 'view'), RateController.rateCompany);
router.post('/rate/company-applicable', authMiddleware, requirePermission(86, 'edit'), RateController.rateCompanyStore);
router.delete('/rate/company-applicable/:id', authMiddleware, requirePermission(86, 'delete'), RateController.rateCompanyDelete);
// /rate/code-item alias (rate-promotion modal, must precede /rate/:id)
router.get('/rate/code-item', authMiddleware, requirePermission(83, 'view'), ReservationController.codeItemList);
router.post('/rate/code-item', authMiddleware, requirePermission(83, 'add'), ReservationController.codeItemList);
// ── /rate/promotion — RateRelationController::promotion parity (must precede /rate/:id) ──
router.get('/rate/promotion', authMiddleware, requirePermission(88, 'view'), PromotionController.ratePromotionList);
router.post('/rate/promotion', authMiddleware, requirePermission(88, 'edit'), PromotionController.ratePromotionStore);
router.delete('/rate/promotion/:id', authMiddleware, requirePermission(88, 'edit'), PromotionController.ratePromotionDelete);
router.get('/rate/:id', authMiddleware, requirePermission(86, 'view'), RateController.show);
router.get('/rate/:id/edit', authMiddleware, requirePermission(86, 'edit'), RateController.edit);
router.put('/rate/:id', authMiddleware, requirePermission(86, 'edit'), RateController.update);
router.delete('/rate/:id', authMiddleware, requirePermission(86, 'delete'), RateController.destroy);
router.post('/rate/:id/restore', authMiddleware, requirePermission(86, 'edit'), RateController.restore);

// ── Rate Grid (rate_rates calendar) (menuId: 86) ──
router.get('/rates/:rateId/grid', authMiddleware, requirePermission(86, 'view'), RateController.rateGrid);
router.post('/rates/:rateId/grid', authMiddleware, requirePermission(86, 'add'), RateController.rateGridStore);
router.put('/rates/:rateId/grid', authMiddleware, requirePermission(86, 'edit'), RateController.rateGridUpdate);
router.get('/rates/:rateId/restrictions', authMiddleware, requirePermission(86, 'view'), RateController.rateGridRestriction);
router.post('/rates/:rateId/restrictions', authMiddleware, requirePermission(86, 'edit'), RateController.rateGridRestrictionStore);

// Singular aliases for rate grid
router.get('/rate/:rateId/grid', authMiddleware, requirePermission(86, 'view'), RateController.rateGrid);
router.post('/rate/:rateId/grid', authMiddleware, requirePermission(86, 'add'), RateController.rateGridStore);
router.put('/rate/:rateId/grid', authMiddleware, requirePermission(86, 'edit'), RateController.rateGridUpdate);
router.get('/rate/:rateId/restrictions', authMiddleware, requirePermission(86, 'view'), RateController.rateGridRestriction);
router.post('/rate/:rateId/restrictions', authMiddleware, requirePermission(86, 'edit'), RateController.rateGridRestrictionStore);

// ── Bar Rate Grid (menuId: 87) ──
router.get('/bar-rates', authMiddleware, requirePermission(87, 'view'), RateController.barRateIndex);
router.get('/bar-rates/create', authMiddleware, requirePermission(87, 'add'), RateController.barRateCreate);
router.post('/bar-rates', authMiddleware, requirePermission(87, 'add'), RateController.barRateStore);
router.put('/bar-rates', authMiddleware, requirePermission(87, 'edit'), RateController.barRateUpdate);

// Singular aliases for bar rates
router.get('/bar-rate', authMiddleware, requirePermission(87, 'view'), RateController.barRateIndex);
router.get('/bar-rate/create', authMiddleware, requirePermission(87, 'add'), RateController.barRateCreate);
router.post('/bar-rate', authMiddleware, requirePermission(87, 'add'), RateController.barRateStore);
router.put('/bar-rate', authMiddleware, requirePermission(87, 'edit'), RateController.barRateUpdate);

// Short alias: /rate/:id/update — frontend form edit URL
router.get('/rate/:id/update', authMiddleware, requirePermission(86, 'edit'), RateController.edit);

// ── Bar Master (menuId: 87) — parity with Laravel BarController (rates where module='bar')
// Order matters: static paths (create, minimum-rate, inclusives) BEFORE /bar/:id
router.get('/bar', authMiddleware, requirePermission(87, 'view'), BarController.list);
router.get('/bar/create', authMiddleware, requirePermission(87, 'add'), BarController.create);
router.post('/bar', authMiddleware, requirePermission(87, 'add'), BarController.store);
router.get('/bar/minimum-rate', authMiddleware, requirePermission(87, 'view'), BarController.getRoomType);
router.put('/bar/minimum-rate/:id', authMiddleware, requirePermission(87, 'edit'), BarController.updateRoomType);

// Bar inclusives (frontend sends bar_id as query param)
router.get('/bar/inclusives', authMiddleware, requirePermission(87, 'view'), (req, res) => {
  req.params.rateId = req.query.bar_id as string;
  return RateAddonController.inclusiveList(req, res);
});
router.post('/bar/inclusives', authMiddleware, requirePermission(87, 'add'), (req, res) => {
  req.params.rateId = req.query.bar_id as string;
  return RateAddonController.inclusiveStore(req, res);
});
router.put('/bar/inclusives/:id', authMiddleware, requirePermission(87, 'edit'), RateAddonController.inclusiveUpdate);
router.delete('/bar/inclusives/:id', authMiddleware, requirePermission(87, 'delete'), RateAddonController.inclusiveDestroy);
router.delete('/bar/inclusives/:id/delete', authMiddleware, requirePermission(87, 'delete'), RateAddonController.inclusiveDelete);

// ── /bar/rate — rate-bar/form grid page (must precede /bar/:id) ──
router.get('/bar/rate', authMiddleware, requirePermission(87, 'view'), (req, res) => {
  req.query.rate_id = rateIdFromQuery(req);
  return RateController.barRateIndex(req, res);
});
router.post('/bar/rate', authMiddleware, requirePermission(87, 'view'), (req, res) => {
  gridQuery(req);
  req.query.rate_id = rateIdFromQuery(req);
  return RateController.barRateIndex(req, res);
});
router.get('/bar/rate/create', authMiddleware, requirePermission(87, 'add'), RateController.barRateCreate);
router.post('/bar/rate/store', authMiddleware, requirePermission(87, 'add'), (req, res) => {
  if (req.body.rate_id === undefined && req.body.bar_id !== undefined) req.body.rate_id = req.body.bar_id;
  return RateController.barRateStore(req, res);
});
router.put('/bar/rate/:id', authMiddleware, requirePermission(87, 'edit'), (req, res) => {
  if (req.body.rate_id === undefined) req.body.rate_id = req.params.id;
  return RateController.barRateUpdate(req, res);
});
router.get('/bar/rate/:id/update', authMiddleware, requirePermission(87, 'edit'), RateController.barRateCreate);

// ── /bar/rate-link-listing — BarRelationController::link parity (must precede /bar/:id) ──
router.get('/bar/rate-link-listing', authMiddleware, requirePermission(87, 'view'), (req, res) => {
  const barId = String(req.query.bar_id ?? req.query.rate_id ?? '');
  if (!/^\d+$/.test(barId)) { return RateController.emptyGrid(res); }
  req.params.barId = barId;
  return RateAddonController.barRelationLink(req, res);
});

router.get('/bar/:id/update', authMiddleware, requirePermission(87, 'edit'), BarController.edit);
router.get('/bar/:id', authMiddleware, requirePermission(87, 'view'), BarController.show);
router.put('/bar/:id', authMiddleware, requirePermission(87, 'edit'), BarController.update);
router.delete('/bar/:id', authMiddleware, requirePermission(87, 'delete'), BarController.destroy);
router.delete('/bar/:id/delete', authMiddleware, requirePermission(87, 'delete'), BarController.forceDelete);
router.post('/bar/:id/restore', authMiddleware, requirePermission(87, 'edit'), BarController.restore);

// ── Day Use Rates (menuId: 86) ──
router.get('/rates/:rateId/day-uses', authMiddleware, requirePermission(86, 'view'), RateController.dayUseList);
router.post('/rates/:rateId/day-uses', authMiddleware, requirePermission(86, 'add'), RateController.dayUseStore);
router.put('/day-uses/:id', authMiddleware, requirePermission(86, 'edit'), RateController.dayUseUpdate);
router.delete('/day-uses/:id', authMiddleware, requirePermission(86, 'delete'), RateController.dayUseDestroy);

// Singular aliases for day use rates
router.get('/rate/:rateId/day-uses', authMiddleware, requirePermission(86, 'view'), RateController.dayUseList);
router.post('/rate/:rateId/day-uses', authMiddleware, requirePermission(86, 'add'), RateController.dayUseStore);
router.put('/day-use/:id', authMiddleware, requirePermission(86, 'edit'), RateController.dayUseUpdate);
router.delete('/day-use/:id', authMiddleware, requirePermission(86, 'delete'), RateController.dayUseDestroy);

// ── Rate Configs (menuId: 86) ──
router.get('/rates/:rateId/configs', authMiddleware, requirePermission(86, 'view'), RateController.configList);
router.post('/rates/:rateId/configs', authMiddleware, requirePermission(86, 'add'), RateController.configStore);
router.put('/rate-configs/:id', authMiddleware, requirePermission(86, 'edit'), RateController.configUpdate);
router.delete('/rate-configs/:id', authMiddleware, requirePermission(86, 'delete'), RateController.configDestroy);

// Singular aliases for rate configs
router.get('/rate/:rateId/configs', authMiddleware, requirePermission(86, 'view'), RateController.configList);
router.post('/rate/:rateId/configs', authMiddleware, requirePermission(86, 'add'), RateController.configStore);
router.put('/rate-config/:id', authMiddleware, requirePermission(86, 'edit'), RateController.configUpdate);
router.delete('/rate-config/:id', authMiddleware, requirePermission(86, 'delete'), RateController.configDestroy);

// ── Rate Inclusives (menuId: 86) ──
router.get('/rates/:rateId/inclusives', authMiddleware, requirePermission(86, 'view'), RateAddonController.inclusiveList);
router.post('/rates/:rateId/inclusives', authMiddleware, requirePermission(86, 'add'), RateAddonController.inclusiveStore);
router.put('/rate-inclusives/:id', authMiddleware, requirePermission(86, 'edit'), RateAddonController.inclusiveUpdate);
router.delete('/rate-inclusives/:id', authMiddleware, requirePermission(86, 'delete'), RateAddonController.inclusiveDestroy);
router.delete('/rate-inclusives/:id/force', authMiddleware, requirePermission(86, 'delete'), RateAddonController.inclusiveDelete);

// ── /rate/extra-bed/inclusives — RateExtraBedInclusiveController parity (must precede /rate/:rateId/inclusives) ──
router.get('/rate/extra-bed/inclusives', authMiddleware, requirePermission(86, 'view'), (req, res) => {
  req.params.rateId = String(req.query.rate_id ?? req.query.id ?? '');
  RateAddonController.extraBedList(req, res);
});
router.post('/rate/extra-bed/inclusives', authMiddleware, requirePermission(86, 'add'), (req, res) => {
  req.params.rateId = String(req.query.rate_id ?? req.query.id ?? '');
  RateAddonController.extraBedStore(req, res);
});
router.put('/rate/extra-bed/inclusives/:id', authMiddleware, requirePermission(86, 'edit'), RateAddonController.extraBedUpdate);
router.delete('/rate/extra-bed/inclusives/:id', authMiddleware, requirePermission(86, 'delete'), RateAddonController.extraBedDestroy);
router.delete('/rate/extra-bed/inclusives/:id/delete', authMiddleware, requirePermission(86, 'delete'), RateAddonController.extraBedDelete);

// Singular aliases for rate inclusives
router.get('/rate/:rateId/inclusives', authMiddleware, requirePermission(86, 'view'), RateAddonController.inclusiveList);
router.post('/rate/:rateId/inclusives', authMiddleware, requirePermission(86, 'add'), RateAddonController.inclusiveStore);
router.put('/rate-inclusive/:id', authMiddleware, requirePermission(86, 'edit'), RateAddonController.inclusiveUpdate);
router.delete('/rate-inclusive/:id', authMiddleware, requirePermission(86, 'delete'), RateAddonController.inclusiveDestroy);
router.delete('/rate-inclusive/:id/force', authMiddleware, requirePermission(86, 'delete'), RateAddonController.inclusiveDelete);

// ── Rate Extra Bed Inclusives (menuId: 86) ──
router.get('/rates/:rateId/extra-beds', authMiddleware, requirePermission(86, 'view'), RateAddonController.extraBedList);
router.post('/rates/:rateId/extra-beds', authMiddleware, requirePermission(86, 'add'), RateAddonController.extraBedStore);
router.put('/rate-extra-beds/:id', authMiddleware, requirePermission(86, 'edit'), RateAddonController.extraBedUpdate);
router.delete('/rate-extra-beds/:id', authMiddleware, requirePermission(86, 'delete'), RateAddonController.extraBedDestroy);
router.delete('/rate-extra-beds/:id/force', authMiddleware, requirePermission(86, 'delete'), RateAddonController.extraBedDelete);

// Singular aliases for extra beds
router.get('/rate/:rateId/extra-beds', authMiddleware, requirePermission(86, 'view'), RateAddonController.extraBedList);
router.post('/rate/:rateId/extra-beds', authMiddleware, requirePermission(86, 'add'), RateAddonController.extraBedStore);
router.put('/rate-extra-bed/:id', authMiddleware, requirePermission(86, 'edit'), RateAddonController.extraBedUpdate);
router.delete('/rate-extra-bed/:id', authMiddleware, requirePermission(86, 'delete'), RateAddonController.extraBedDestroy);
router.delete('/rate-extra-bed/:id/force', authMiddleware, requirePermission(86, 'delete'), RateAddonController.extraBedDelete);

// ── Bar Relations (menuId: 87) ──
router.get('/bar-rates/:barId/relations', authMiddleware, requirePermission(87, 'view'), RateAddonController.barRelationIndex);
router.get('/bar-rates/:barId/links', authMiddleware, requirePermission(87, 'view'), RateAddonController.barRelationLink);

// Singular aliases for bar relations
router.get('/bar-rate/:barId/relations', authMiddleware, requirePermission(87, 'view'), RateAddonController.barRelationIndex);
router.get('/bar-rate/:barId/links', authMiddleware, requirePermission(87, 'view'), RateAddonController.barRelationLink);

// ── Dynamic Rate Config (menuId: 1102) ──
router.get('/dynamic-rates', authMiddleware, requirePermission(1102, 'view'), DynamicRateController.list);
router.get('/dynamic-rates/create', authMiddleware, requirePermission(1102, 'add'), DynamicRateController.create);
router.post('/dynamic-rates', authMiddleware, requirePermission(1102, 'add'), DynamicRateController.store);
router.get('/dynamic-rates/:id', authMiddleware, requirePermission(1102, 'view'), DynamicRateController.show);
router.get('/dynamic-rates/:id/edit', authMiddleware, requirePermission(1102, 'edit'), DynamicRateController.edit);
router.put('/dynamic-rates/:id', authMiddleware, requirePermission(1102, 'edit'), DynamicRateController.update);
router.delete('/dynamic-rates/:id', authMiddleware, requirePermission(1102, 'delete'), DynamicRateController.destroy);
router.delete('/dynamic-rates/:id/force', authMiddleware, requirePermission(1102, 'delete'), DynamicRateController.delete);

// Singular aliases for dynamic rates
router.get('/dynamic-rate', authMiddleware, requirePermission(1102, 'view'), DynamicRateController.list);
router.get('/dynamic-rate/create', authMiddleware, requirePermission(1102, 'add'), DynamicRateController.create);
router.post('/dynamic-rate', authMiddleware, requirePermission(1102, 'add'), DynamicRateController.store);
router.get('/dynamic-rate/:id', authMiddleware, requirePermission(1102, 'view'), DynamicRateController.show);
router.get('/dynamic-rate/:id/edit', authMiddleware, requirePermission(1102, 'edit'), DynamicRateController.edit);
router.put('/dynamic-rate/:id', authMiddleware, requirePermission(1102, 'edit'), DynamicRateController.update);
router.delete('/dynamic-rate/:id', authMiddleware, requirePermission(1102, 'delete'), DynamicRateController.destroy);
router.delete('/dynamic-rate/:id/force', authMiddleware, requirePermission(1102, 'delete'), DynamicRateController.delete);

// ── Dynamic Rate Actions ──
router.post('/dynamic-rates/:id/calculate', authMiddleware, requirePermission(1102, 'edit'), DynamicRateController.calculate);
router.post('/dynamic-rates/:id/apply', authMiddleware, requirePermission(1102, 'edit'), DynamicRateController.apply);
router.post('/dynamic-rates/:id/sync', authMiddleware, requirePermission(1102, 'edit'), DynamicRateController.sync);
router.post('/dynamic-rates/:id/disable', authMiddleware, requirePermission(1102, 'edit'), DynamicRateController.disable);
router.get('/dynamic-rates/:id/results', authMiddleware, requirePermission(1102, 'view'), DynamicRateController.results);
router.get('/dynamic-rates/:id/statistics', authMiddleware, requirePermission(1102, 'view'), DynamicRateController.statistics);

// Singular aliases for dynamic rate actions
router.post('/dynamic-rate/:id/calculate', authMiddleware, requirePermission(1102, 'edit'), DynamicRateController.calculate);
router.post('/dynamic-rate/:id/apply', authMiddleware, requirePermission(1102, 'edit'), DynamicRateController.apply);
router.post('/dynamic-rate/:id/sync', authMiddleware, requirePermission(1102, 'edit'), DynamicRateController.sync);
router.post('/dynamic-rate/:id/disable', authMiddleware, requirePermission(1102, 'edit'), DynamicRateController.disable);
router.get('/dynamic-rate/:id/results', authMiddleware, requirePermission(1102, 'view'), DynamicRateController.results);
router.get('/dynamic-rate/:id/statistics', authMiddleware, requirePermission(1102, 'view'), DynamicRateController.statistics);

// ── Promotions (menuId: 88) ──
router.get('/promotions', authMiddleware, requirePermission(88, 'view'), PromotionController.list);
router.get('/promotions/create', authMiddleware, requirePermission(88, 'add'), PromotionController.create);
router.post('/promotions', authMiddleware, requirePermission(88, 'add'), PromotionController.store);
router.get('/promotions/:id', authMiddleware, requirePermission(88, 'view'), PromotionController.show);
router.get('/promotions/:id/edit', authMiddleware, requirePermission(88, 'edit'), PromotionController.edit);
router.put('/promotions/:id', authMiddleware, requirePermission(88, 'edit'), PromotionController.update);
router.delete('/promotions/:id', authMiddleware, requirePermission(88, 'delete'), PromotionController.destroy);
router.delete('/promotions/:id/force', authMiddleware, requirePermission(88, 'delete'), PromotionController.delete);
router.post('/promotions/:id/restore', authMiddleware, requirePermission(88, 'edit'), PromotionController.restore);

// Singular aliases for promotions
router.get('/promotion', authMiddleware, requirePermission(88, 'view'), PromotionController.list);
router.get('/promotion/create', authMiddleware, requirePermission(88, 'add'), PromotionController.create);
router.post('/promotion', authMiddleware, requirePermission(88, 'add'), PromotionController.store);
router.get('/promotion/:id', authMiddleware, requirePermission(88, 'view'), PromotionController.show);
router.get('/promotion/:id/edit', authMiddleware, requirePermission(88, 'edit'), PromotionController.edit);
router.put('/promotion/:id', authMiddleware, requirePermission(88, 'edit'), PromotionController.update);
router.delete('/promotion/:id', authMiddleware, requirePermission(88, 'delete'), PromotionController.destroy);
router.delete('/promotion/:id/force', authMiddleware, requirePermission(88, 'delete'), PromotionController.delete);
router.post('/promotion/:id/restore', authMiddleware, requirePermission(88, 'edit'), PromotionController.restore);
router.get('/promotion/:id/update', authMiddleware, requirePermission(88, 'edit'), PromotionController.edit);

// ── Company Contract Rates (menuId: 83) ──
router.get('/company-contract-rates', authMiddleware, requirePermission(83, 'view'), CompanyContractRateController.list);
router.get('/company-contract-rates/create', authMiddleware, requirePermission(83, 'add'), CompanyContractRateController.create);
router.post('/company-contract-rates', authMiddleware, requirePermission(83, 'add'), CompanyContractRateController.store);
router.get('/company-contract-rates/:id', authMiddleware, requirePermission(83, 'view'), CompanyContractRateController.show);
router.get('/company-contract-rates/:id/edit', authMiddleware, requirePermission(83, 'edit'), CompanyContractRateController.edit);
router.put('/company-contract-rates/:id', authMiddleware, requirePermission(83, 'edit'), CompanyContractRateController.update);
router.delete('/company-contract-rates/:id', authMiddleware, requirePermission(83, 'delete'), CompanyContractRateController.destroy);
router.post('/company-contract-rates/:id/restore', authMiddleware, requirePermission(83, 'edit'), CompanyContractRateController.restore);

// Singular aliases for company contract rates
router.get('/company-contract-rate', authMiddleware, requirePermission(83, 'view'), CompanyContractRateController.list);
router.get('/company-contract-rate/create', authMiddleware, requirePermission(83, 'add'), CompanyContractRateController.create);
router.post('/company-contract-rate', authMiddleware, requirePermission(83, 'add'), CompanyContractRateController.store);
router.get('/company-contract-rate/:id', authMiddleware, requirePermission(83, 'view'), CompanyContractRateController.show);
router.get('/company-contract-rate/:id/edit', authMiddleware, requirePermission(83, 'edit'), CompanyContractRateController.edit);
router.put('/company-contract-rate/:id', authMiddleware, requirePermission(83, 'edit'), CompanyContractRateController.update);
router.delete('/company-contract-rate/:id', authMiddleware, requirePermission(83, 'delete'), CompanyContractRateController.destroy);
router.post('/company-contract-rate/:id/restore', authMiddleware, requirePermission(83, 'edit'), CompanyContractRateController.restore);
router.get('/company-contract-rate/:id/update', authMiddleware, requirePermission(83, 'edit'), CompanyContractRateController.edit);

// /profile/company-contract-rate alias (frontend page)
router.get('/profile/company-contract-rate', authMiddleware, requirePermission(83, 'view'), CompanyContractRateController.list);
router.post('/profile/company-contract-rate', authMiddleware, requirePermission(83, 'add'), CompanyContractRateController.store);
router.put('/profile/company-contract-rate/:id', authMiddleware, requirePermission(83, 'edit'), CompanyContractRateController.update);
router.delete('/profile/company-contract-rate/:id', authMiddleware, requirePermission(83, 'delete'), CompanyContractRateController.destroy);

export default router;
