import { Router } from 'express';
import { PosMobileController } from '../controllers/pos-mobile.controller';

// Mobile POS API (Laravel routes/web.php parity, no auth).
export const posRoutes = Router();

// Hotel competitor map (Laravel web.php /map, MapsController@index — Blade view parity)
posRoutes.get('/map', PosMobileController.mapIndex);

posRoutes.post('/pos/type-payment', PosMobileController.typePayment);
posRoutes.post('/pos/post-code', PosMobileController.postCode);
posRoutes.post('/pos/get-deposit', PosMobileController.getDeposit);
posRoutes.post('/pos/get-folio', PosMobileController.getFolio);
posRoutes.post('/pos/post-transactions', PosMobileController.postTransactions);
