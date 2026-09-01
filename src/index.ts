import 'dotenv/config';

// Timezone sweep — pin Node TZ ke WIB (= Laravel config app.timezone Asia/Jakarta)
// SEBELUM import modul lain agar semua Date default memakai zona ini.
process.env.TZ = process.env.APP_TZ || 'Asia/Jakarta';

import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import { requestLogger } from './middleware/logger.middleware';
import { requestParser } from './middleware/requestParser.middleware';
import { errorHandler } from './middleware/errorHandler.middleware';
import { success, notFound } from './utils/response';
import authRoutes from './routes/auth.routes';
import userGuestRoutes from './routes/user-guest.routes';
import reservationRoutes from './routes/reservation.routes';
import rateRoutes from './routes/rate.routes';
import roomRoutes from './routes/room.routes';
import frontDeskRoutes from './routes/front-desk.routes';
import folioRoutes from './routes/folio.routes';
import frontDeskExtrasRoutes from './routes/front-desk-extras.routes';
import staahRoutes from './routes/staah.routes';
import masterSystemRoutes from './routes/master-system.routes';
import reportRoutes from './routes/report.routes';
import adminRoutes from './routes/admin.routes';
import masterSetupRoutes from './routes/master-setup.routes';
import companyRoutes from './routes/company.routes';
import housekeepingRoutes from './routes/housekeeping.routes';
import conciergeRoutes from './routes/concierge.routes';
import eventRoutes from './routes/event.routes';
import statisticRoutes from './routes/statistic.routes';
import genericRoutes from './routes/generic.routes';
import extraRoutes from './routes/extra.routes';
import contentRoutes from './routes/content.routes';
import { firebaseRoutes } from './controllers/firebase.controller';
import pgAdminRoutes from './routes/pg-admin.routes';
import { bookingRoutes } from './routes/booking.routes';
import { posRoutes } from './routes/pos.routes';
import { initQueue } from './config/queue';

const app: Express = express();
const port = process.env.PORT || 3000;

// ============================================================
// Global Middleware (order matters — replicates Laravel Kernel)
// ============================================================

// 1. CORS — allow frontend (Next.js) and native apps
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Token', 'X-Property-Id', 'Authorization', 'Accept'],
}));

// 2. Body parsing — json + urlencoded + text/plain (for AES-encrypted payloads)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.text({ limit: '10mb', type: 'text/plain' }));

// 2b. Static files — Laravel storage/app/public parity (/storage/{path})
app.use('/storage', express.static(path.join(process.cwd(), 'storage')));

// 2c. Theme static files — SVG icons, images (/theme/cms/images/...)
app.use('/theme', express.static(path.join(process.cwd(), 'theme')));

// 3. Request logger
app.use(requestLogger);

// 4. Request parser (trim strings, null empty strings, 201→200, CORS headers)
app.use(requestParser);

// ============================================================
// Routes
// ============================================================

// Health check
app.get('/', (_req: Request, res: Response) => {
  success(res, { version: '1.0.0', name: 'HMS Anyaman Node.js Backend' }, 'Server running');
});

// API routes (mounted by route modules)
app.get('/api/status', (_req: Request, res: Response) => {
  success(res, { db: 'connected', phase: 4 }, 'API operational');
});

const mountLegacyCmsAlias = (...routers: any[]) => {
  routers.forEach((router) => app.use('/api/cms', router));
};

// Auth routes — matches Laravel cms.php prefix
app.use('/api', authRoutes);
app.use('/cms', authRoutes);
mountLegacyCmsAlias(authRoutes);

// User & Guest routes — Phase 4.1
app.use('/api', userGuestRoutes);
app.use('/cms', userGuestRoutes);
mountLegacyCmsAlias(userGuestRoutes);

// Reservation routes — Phase 4.2
app.use('/api', reservationRoutes);
app.use('/cms', reservationRoutes);
mountLegacyCmsAlias(reservationRoutes);

// Pricing & Rate routes — Phase 4.3
app.use('/api', rateRoutes);
app.use('/cms', rateRoutes);
mountLegacyCmsAlias(rateRoutes);

// Room Management routes — Phase 4.2
app.use('/api', roomRoutes);
app.use('/cms', roomRoutes);
mountLegacyCmsAlias(roomRoutes);

// Front Desk routes — Phase 4.2
app.use('/api', frontDeskRoutes);
app.use('/cms', frontDeskRoutes);
mountLegacyCmsAlias(frontDeskRoutes);

// Folio Management routes — Phase 4.2
app.use('/api', folioRoutes);
app.use('/cms', folioRoutes);
mountLegacyCmsAlias(folioRoutes);

// Front Desk extras — wake-up-call, auto-transfer, billing-to, door-lock keys, deposit-payment
app.use('/api', frontDeskExtrasRoutes);
app.use('/cms', frontDeskExtrasRoutes);
mountLegacyCmsAlias(frontDeskExtrasRoutes);

// STAAH OTA Integration routes — Phase 4.4
app.use('/api', staahRoutes);
app.use('/cms', staahRoutes);
mountLegacyCmsAlias(staahRoutes);

// POS & Accounting routes — Phase 4.5
app.use('/api', masterSystemRoutes);
app.use('/cms', masterSystemRoutes);
mountLegacyCmsAlias(masterSystemRoutes);

// Reports routes — Phase 4.6
// report.routes.ts uses absolute /cms/... paths → mount at root (no prefix strip)
app.use(reportRoutes);
// Also under /api for parity with Laravel cms.php (mounted at /api/cms/...)
app.use('/api', reportRoutes);

// Admin routes — Roles, Permissions, Menus, Settings, Tasks, Logs
app.use('/api', adminRoutes);
app.use('/cms', adminRoutes);
mountLegacyCmsAlias(adminRoutes);

// Master Setup routes — TypePayment, Countries, Cities, Holidays
app.use('/api', masterSetupRoutes);
app.use('/cms', masterSetupRoutes);
mountLegacyCmsAlias(masterSetupRoutes);

// Company Profile routes — Sales & Marketing
app.use('/api', companyRoutes);
app.use('/cms', companyRoutes);
mountLegacyCmsAlias(companyRoutes);

// Housekeeping routes — Phase 4.8
app.use('/api', housekeepingRoutes);
app.use('/cms', housekeepingRoutes);
mountLegacyCmsAlias(housekeepingRoutes);

// Concierge routes — Phase 4.8
app.use('/api', conciergeRoutes);
app.use('/cms', conciergeRoutes);
mountLegacyCmsAlias(conciergeRoutes);

// Event Management routes — Phase 4.8
app.use('/api', eventRoutes);
app.use('/cms', eventRoutes);
mountLegacyCmsAlias(eventRoutes);

// Statistic routes — Phase 4.8
app.use('/api', statisticRoutes);
app.use('/cms', statisticRoutes);
mountLegacyCmsAlias(statisticRoutes);

// Generic CRUD routes — Phase 5.2 (auto-generates list/create/show/update/delete/restore for any model)
app.use('/api/generic', genericRoutes);
app.use('/cms/generic', genericRoutes);

// Extra modules — allotment, overbooking, yield, competitor, statistic/occupancy, countryByRegion, email
app.use('/api', extraRoutes);
app.use('/cms', extraRoutes);
mountLegacyCmsAlias(extraRoutes);

// Content module — Phase 8 (contents, banners, cancelation rules, emails, other-guests)
app.use('/api', contentRoutes);
app.use('/cms', contentRoutes);
mountLegacyCmsAlias(contentRoutes);

// Firebase Push Notifications
app.use('/api', firebaseRoutes);
app.use('/cms', firebaseRoutes);
mountLegacyCmsAlias(firebaseRoutes);

// pg-admin — database UI (dev only, protect with PG_ADMIN_TOKEN in prod)
app.use('/pg-admin', pgAdminRoutes);

// Mobile booking engine (Laravel web.php parity, public)
app.use('/booking', bookingRoutes);

// Mobile POS (Laravel web.php parity, public)
app.use(posRoutes);

// ============================================================
// 404 Catch-all
// ============================================================
app.use((_req: Request, res: Response) => {
  notFound(res, 'Not Found');
});

// ============================================================
// Error Handler (must be last)
// ============================================================
app.use(errorHandler);

// ============================================================
// Start Server
// ============================================================
const startServer = async () => {
  await initQueue();
  
  app.listen(port, () => {
    console.log(`[server] HMS Anyaman running at http://localhost:${port}`);
    console.log(`[server] Phase 4.2: Room Management active`);
    console.log(`[server] Phase 4.3: Pricing & Rate Management active`);
    console.log(`[server] Phase 4.4: STAAH OTA Integration active`);
    console.log(`[server] Phase 4.5: POS & Accounting active`);
    console.log(`[server] Phase 4.6: Reports active (Excel)`);
    console.log(`[server] Phase 4.7: Admin, Master Setup, Company active`);
    console.log(`[server] Phase 4.8: Housekeeping, Concierge, Event, Statistic, Night Audit, Front Desk Extras, Guest Sub-features active`);
  });
};

startServer();

export default app;
