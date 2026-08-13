import { Router } from 'express';
import { MasterDataController } from '../controllers/master-data.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/permission.middleware';

const router = Router();

// Type Payment (menuId: ~)
router.get('/type-payments', authMiddleware, MasterDataController.typePaymentList);
router.get('/type-payments/create', authMiddleware, (req, res) => { req.params.model = 'type_payments'; MasterDataController.masterForm(req, res); });
router.post('/type-payments', authMiddleware, MasterDataController.typePaymentStore);
router.get('/type-payments/:id', authMiddleware, MasterDataController.typePaymentShow);
router.get('/type-payments/:id/update', authMiddleware, MasterDataController.typePaymentShow);
router.put('/type-payments/:id', authMiddleware, MasterDataController.typePaymentUpdate);
router.delete('/type-payments/:id', authMiddleware, MasterDataController.typePaymentDestroy);

// Singular aliases for frontend compatibility
router.get('/type-payment', authMiddleware, MasterDataController.typePaymentList);
router.get('/type-payment/create', authMiddleware, (req, res) => { req.params.model = 'type_payments'; MasterDataController.masterForm(req, res); });
router.post('/type-payment', authMiddleware, MasterDataController.typePaymentStore);
router.get('/type-payment/:id', authMiddleware, MasterDataController.typePaymentShow);
router.get('/type-payment/:id/update', authMiddleware, MasterDataController.typePaymentShow);
router.put('/type-payment/:id', authMiddleware, MasterDataController.typePaymentUpdate);
router.delete('/type-payment/:id', authMiddleware, MasterDataController.typePaymentDestroy);

// Country (menuId: 58)
router.get('/countries', authMiddleware, MasterDataController.countryList);
router.get('/countries/create', authMiddleware, (req, res) => { req.params.model = 'countries'; MasterDataController.masterForm(req, res); });
router.post('/countries', authMiddleware, MasterDataController.countryStore);
router.get('/countries/:id', authMiddleware, MasterDataController.countryShow);
router.get('/countries/:id/update', authMiddleware, MasterDataController.countryShow);
router.put('/countries/:id', authMiddleware, MasterDataController.countryUpdate);
router.delete('/countries/:id', authMiddleware, MasterDataController.countryDestroy);

// Singular aliases for frontend compatibility
router.get('/country', authMiddleware, MasterDataController.countryList);
router.get('/country/create', authMiddleware, (req, res) => { req.params.model = 'countries'; MasterDataController.masterForm(req, res); });
router.post('/country', authMiddleware, MasterDataController.countryStore);
router.get('/country/:id', authMiddleware, MasterDataController.countryShow);
router.get('/country/:id/update', authMiddleware, MasterDataController.countryShow);
router.put('/country/:id', authMiddleware, MasterDataController.countryUpdate);
router.delete('/country/:id', authMiddleware, MasterDataController.countryDestroy);

// City (menuId: 58)
router.get('/cities', authMiddleware, MasterDataController.cityList);
router.get('/cities/create', authMiddleware, (req, res) => { req.params.model = 'cities'; MasterDataController.masterForm(req, res); });
router.post('/cities', authMiddleware, MasterDataController.cityStore);
router.get('/cities/:id', authMiddleware, MasterDataController.cityShow);
router.get('/cities/:id/update', authMiddleware, MasterDataController.cityShow);
router.put('/cities/:id', authMiddleware, MasterDataController.cityUpdate);
router.delete('/cities/:id', authMiddleware, MasterDataController.cityDestroy);

// Singular aliases for frontend compatibility
router.get('/city', authMiddleware, MasterDataController.cityList);
router.get('/city/create', authMiddleware, (req, res) => { req.params.model = 'cities'; MasterDataController.masterForm(req, res); });
router.post('/city', authMiddleware, MasterDataController.cityStore);
router.get('/city/:id', authMiddleware, MasterDataController.cityShow);
router.get('/city/:id/update', authMiddleware, MasterDataController.cityShow);
router.put('/city/:id', authMiddleware, MasterDataController.cityUpdate);
router.delete('/city/:id', authMiddleware, MasterDataController.cityDestroy);

// Holiday (menuId: ~)
router.get('/holidays', authMiddleware, MasterDataController.holidayList);
router.get('/holidays/create', authMiddleware, (req, res) => { req.params.model = 'holidays'; MasterDataController.masterForm(req, res); });
router.post('/holidays', authMiddleware, MasterDataController.holidayStore);
router.get('/holidays/:id', authMiddleware, MasterDataController.holidayShow);
router.get('/holidays/:id/update', authMiddleware, MasterDataController.holidayShow);
router.put('/holidays/:id', authMiddleware, MasterDataController.holidayUpdate);
router.delete('/holidays/:id', authMiddleware, MasterDataController.holidayDestroy);

// Singular aliases for frontend compatibility
router.get('/holiday', authMiddleware, MasterDataController.holidayList);
router.get('/holiday/create', authMiddleware, (req, res) => { req.params.model = 'holidays'; MasterDataController.masterForm(req, res); });
router.post('/holiday', authMiddleware, MasterDataController.holidayStore);
router.get('/holiday/:id', authMiddleware, MasterDataController.holidayShow);
router.get('/holiday/:id/update', authMiddleware, MasterDataController.holidayShow);
router.put('/holiday/:id', authMiddleware, MasterDataController.holidayUpdate);
router.delete('/holiday/:id', authMiddleware, MasterDataController.holidayDestroy);

// Code Post (menuId: ~)
router.get('/code-posts', authMiddleware, MasterDataController.codePostList);
router.post('/code-posts', authMiddleware, MasterDataController.codePostCreate);
router.get('/code-posts/:id', authMiddleware, MasterDataController.codePostShow);
router.put('/code-posts/:id', authMiddleware, MasterDataController.codePostUpdate);
router.delete('/code-posts/:id', authMiddleware, MasterDataController.codePostDestroy);

// Singular aliases for frontend compatibility
router.get('/code-post', authMiddleware, MasterDataController.codePostList);
router.post('/code-post', authMiddleware, MasterDataController.codePostCreate);
router.get('/code-post/:id', authMiddleware, MasterDataController.codePostShow);
router.put('/code-post/:id', authMiddleware, MasterDataController.codePostUpdate);
router.delete('/code-post/:id', authMiddleware, MasterDataController.codePostDestroy);

// Code Item (menuId: ~)
router.get('/code-items', authMiddleware, MasterDataController.codeItemList);
router.post('/code-items', authMiddleware, MasterDataController.codeItemCreate);
router.get('/code-items/:id', authMiddleware, MasterDataController.codeItemShow);
router.put('/code-items/:id', authMiddleware, MasterDataController.codeItemUpdate);
router.delete('/code-items/:id', authMiddleware, MasterDataController.codeItemDestroy);

// Singular aliases for frontend compatibility
router.get('/code-item', authMiddleware, MasterDataController.codeItemList);
router.post('/code-item', authMiddleware, MasterDataController.codeItemCreate);
router.get('/code-item/:id', authMiddleware, MasterDataController.codeItemShow);
router.put('/code-item/:id', authMiddleware, MasterDataController.codeItemUpdate);
router.delete('/code-item/:id', authMiddleware, MasterDataController.codeItemDestroy);

// Code Billing (menuId: ~)
router.get('/code-billings', authMiddleware, MasterDataController.codeBillingList);
router.post('/code-billings', authMiddleware, MasterDataController.codeBillingCreate);
router.get('/code-billings/:id', authMiddleware, MasterDataController.codeBillingShow);
router.put('/code-billings/:id', authMiddleware, MasterDataController.codeBillingUpdate);
router.delete('/code-billings/:id', authMiddleware, MasterDataController.codeBillingDestroy);

// Singular aliases for frontend compatibility
router.get('/code-billing', authMiddleware, MasterDataController.codeBillingList);
router.post('/code-billing', authMiddleware, MasterDataController.codeBillingCreate);
router.get('/code-billing/:id', authMiddleware, MasterDataController.codeBillingShow);
router.put('/code-billing/:id', authMiddleware, MasterDataController.codeBillingUpdate);
router.delete('/code-billing/:id', authMiddleware, MasterDataController.codeBillingDestroy);

// Code GL (menuId: ~)
router.get('/code-gls', authMiddleware, MasterDataController.codeGlList);
router.post('/code-gls', authMiddleware, MasterDataController.codeGlCreate);
router.get('/code-gls/:id', authMiddleware, MasterDataController.codeGlShow);
router.put('/code-gls/:id', authMiddleware, MasterDataController.codeGlUpdate);
router.delete('/code-gls/:id', authMiddleware, MasterDataController.codeGlDestroy);

// Singular aliases for frontend compatibility
router.get('/holiday', authMiddleware, MasterDataController.holidayList);
router.post('/holiday', authMiddleware, MasterDataController.holidayStore);
router.get('/holiday/:id', authMiddleware, MasterDataController.holidayShow);
router.put('/holiday/:id', authMiddleware, MasterDataController.holidayUpdate);
router.delete('/holiday/:id', authMiddleware, MasterDataController.holidayDestroy);

// ════════════════════════════════════════════════════════════════
// Code Post (code_posts)
// ═══════════════════════════════════════════════════════════════
router.get('/code-posts', authMiddleware, MasterDataController.codePostList);
router.post('/code-posts', authMiddleware, MasterDataController.codePostCreate);
router.get('/code-posts/:id', authMiddleware, MasterDataController.codePostShow);
router.put('/code-posts/:id', authMiddleware, MasterDataController.codePostUpdate);
router.delete('/code-posts/:id', authMiddleware, MasterDataController.codePostDestroy);

// Singular aliases for frontend compatibility
router.get('/code-post', authMiddleware, MasterDataController.codePostList);
router.post('/code-post', authMiddleware, MasterDataController.codePostCreate);
router.get('/code-post/:id', authMiddleware, MasterDataController.codePostShow);
router.put('/code-post/:id', authMiddleware, MasterDataController.codePostUpdate);
router.delete('/code-post/:id', authMiddleware, MasterDataController.codePostDestroy);

// ════════════════════════════════════════════════════════════════
// Code Item (code_items)
// ═══════════════════════════════════════════════════════════════
router.get('/code-items', authMiddleware, MasterDataController.codeItemList);
router.post('/code-items', authMiddleware, MasterDataController.codeItemCreate);
router.get('/code-items/:id', authMiddleware, MasterDataController.codeItemShow);
router.put('/code-items/:id', authMiddleware, MasterDataController.codeItemUpdate);
router.delete('/code-items/:id', authMiddleware, MasterDataController.codeItemDestroy);

// Singular aliases for frontend compatibility
router.get('/code-item', authMiddleware, MasterDataController.codeItemList);
router.post('/code-item', authMiddleware, MasterDataController.codeItemCreate);
router.get('/code-item/:id', authMiddleware, MasterDataController.codeItemShow);
router.put('/code-item/:id', authMiddleware, MasterDataController.codeItemUpdate);
router.delete('/code-item/:id', authMiddleware, MasterDataController.codeItemDestroy);

// ════════════════════════════════════════════════════════════════
// Code Billing (code_billings)
// ═══════════════════════════════════════════════════════════════
router.get('/code-billings', authMiddleware, MasterDataController.codeBillingList);
router.post('/code-billings', authMiddleware, MasterDataController.codeBillingCreate);
router.get('/code-billings/:id', authMiddleware, MasterDataController.codeBillingShow);
router.put('/code-billings/:id', authMiddleware, MasterDataController.codeBillingUpdate);
router.delete('/code-billings/:id', authMiddleware, MasterDataController.codeBillingDestroy);

// Singular aliases for frontend compatibility
router.get('/code-billing', authMiddleware, MasterDataController.codeBillingList);
router.post('/code-billing', authMiddleware, MasterDataController.codeBillingCreate);
router.get('/code-billing/:id', authMiddleware, MasterDataController.codeBillingShow);
router.put('/code-billing/:id', authMiddleware, MasterDataController.codeBillingUpdate);
router.delete('/code-billing/:id', authMiddleware, MasterDataController.codeBillingDestroy);

// ════════════════════════════════════════════════════════════════
// Code GL (code_gls)
// ═══════════════════════════════════════════════════════════════
router.get('/code-gls', authMiddleware, MasterDataController.codeGlList);
router.post('/code-gls', authMiddleware, MasterDataController.codeGlCreate);
router.get('/code-gls/:id', authMiddleware, MasterDataController.codeGlShow);
router.put('/code-gls/:id', authMiddleware, MasterDataController.codeGlUpdate);
router.delete('/code-gls/:id', authMiddleware, MasterDataController.codeGlDestroy);

// Singular aliases for frontend compatibility
router.get('/code-gl', authMiddleware, MasterDataController.codeGlList);
router.post('/code-gl', authMiddleware, MasterDataController.codeGlCreate);
router.get('/code-gl/:id', authMiddleware, MasterDataController.codeGlShow);
router.put('/code-gl/:id', authMiddleware, MasterDataController.codeGlUpdate);
router.delete('/code-gl/:id', authMiddleware, MasterDataController.codeGlDestroy);

export default router;
