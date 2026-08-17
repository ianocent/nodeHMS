import { Router } from 'express';
import { CompanyController } from '../controllers/company.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/permission.middleware';

const router = Router();

// Company Profile (menuId: ~)
router.get('/profile/company', authMiddleware, CompanyController.list);
router.get('/profile/company-v2', authMiddleware, CompanyController.autocomplete);
router.get('/profile/company/create', authMiddleware, CompanyController.createForm);
router.get('/profile/company/:id', authMiddleware, CompanyController.show);
router.get('/profile/company/:id/update', authMiddleware, CompanyController.createForm);
router.post('/profile/company', authMiddleware, CompanyController.store);
router.put('/profile/company/:id', authMiddleware, CompanyController.update);
router.delete('/profile/company/:id', authMiddleware, CompanyController.destroy);

// Client menu (Laravel CompanyController, table `companies`) — /cms/company + /cms/client aliases
router.get('/company', authMiddleware, CompanyController.clientList);
router.get('/company-v2', authMiddleware, CompanyController.autocomplete);
router.get('/company/create', authMiddleware, CompanyController.clientCreateForm);
router.get('/company/:id', authMiddleware, CompanyController.clientShow);
router.get('/company/:id/update', authMiddleware, CompanyController.clientCreateForm);
router.post('/company', authMiddleware, CompanyController.clientStore);
router.put('/company/:id', authMiddleware, CompanyController.clientUpdate);
router.delete('/company/:id', authMiddleware, CompanyController.clientDestroy);

router.get('/client', authMiddleware, CompanyController.clientList);
router.get('/client-v2', authMiddleware, CompanyController.autocomplete);
router.get('/client/create', authMiddleware, CompanyController.clientCreateForm);
router.get('/client/:id', authMiddleware, CompanyController.clientShow);
router.get('/client/:id/update', authMiddleware, CompanyController.clientCreateForm);
router.post('/client', authMiddleware, CompanyController.clientStore);
router.put('/client/:id', authMiddleware, CompanyController.clientUpdate);
router.delete('/client/:id', authMiddleware, CompanyController.clientDestroy);

// Contact Person
router.get('/profile/company-contact', authMiddleware, CompanyController.contactList);
router.post('/profile/company-contact', authMiddleware, CompanyController.contactStore);
router.put('/profile/company-contact/:id', authMiddleware, CompanyController.contactUpdate);
router.delete('/profile/company-contact/:id', authMiddleware, CompanyController.contactDestroy);
router.get('/profile/company/contactPerson/:id', authMiddleware, CompanyController.contactPersonByCompany);

// Department
router.get('/profile/company-department', authMiddleware, CompanyController.deptList);
router.post('/profile/company-department', authMiddleware, CompanyController.deptStore);
router.put('/profile/company-department/:id', authMiddleware, CompanyController.deptUpdate);
router.delete('/profile/company-department/:id', authMiddleware, CompanyController.deptDestroy);

// Activity
router.get('/profile/company-activity', authMiddleware, CompanyController.activityList);
router.post('/profile/company-activity', authMiddleware, CompanyController.activityStore);
router.put('/profile/company-activity/:id', authMiddleware, CompanyController.activityUpdate);
router.delete('/profile/company-activity/:id', authMiddleware, CompanyController.activityDestroy);

// Document
router.get('/profile/company-document', authMiddleware, CompanyController.documentList);
router.post('/profile/company-document', authMiddleware, CompanyController.documentStore);
router.put('/profile/company-document/:id', authMiddleware, CompanyController.documentUpdate);
router.delete('/profile/company-document/:id', authMiddleware, CompanyController.documentDestroy);

// Company Guest
router.get('/profile/company-guest', authMiddleware, CompanyController.guestList);
router.post('/profile/company-guest', authMiddleware, CompanyController.guestStore);
router.delete('/profile/company-guest/:id', authMiddleware, CompanyController.guestDestroy);

// Company Folio
router.get('/profile/company-folio', authMiddleware, CompanyController.folioList);

// AR Transaction
router.get('/profile/company-ar-transaction', authMiddleware, CompanyController.arTransactionList);
router.post('/profile/company-ar-transaction', authMiddleware, CompanyController.arTransactionStore);
router.delete('/profile/company-ar-transaction/:id', authMiddleware, CompanyController.arTransactionDestroy);

// Statistic
router.get('/profile/company-statistic', authMiddleware, CompanyController.statisticIndex);

// Company Profile Billing Setup
router.get('/company-profile-billing-setup', authMiddleware, CompanyController.billingSetupList);
router.post('/company-profile-billing-setup', authMiddleware, CompanyController.billingSetupStore);
router.delete('/company-profile-billing-setup/:id', authMiddleware, CompanyController.billingSetupDestroy);

export default router;
