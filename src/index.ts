import 'dotenv/config';
import express, { Express, Request, Response } from 'express';
import cors from 'cors';
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

// Auth routes — matches Laravel cms.php prefix
app.use('/api', authRoutes);
app.use('/cms', authRoutes);

// User & Guest routes — Phase 4.1
app.use('/api', userGuestRoutes);
app.use('/cms', userGuestRoutes);

// Reservation routes — Phase 4.2
app.use('/api', reservationRoutes);
app.use('/cms', reservationRoutes);

// Pricing & Rate routes — Phase 4.3
app.use('/api', rateRoutes);
app.use('/cms', rateRoutes);

// Room Management routes — Phase 4.2
app.use('/api', roomRoutes);
app.use('/cms', roomRoutes);

// Front Desk routes — Phase 4.2
app.use('/api', frontDeskRoutes);
app.use('/cms', frontDeskRoutes);

// Folio Management routes — Phase 4.2
app.use('/api', folioRoutes);
app.use('/cms', folioRoutes);

// STAAH OTA Integration routes — Phase 4.4
app.use('/api', staahRoutes);
app.use('/cms', staahRoutes);

// POS & Accounting routes — Phase 4.5
app.use('/api', masterSystemRoutes);
app.use('/cms', masterSystemRoutes);

// Reports routes — Phase 4.6
// report.routes.ts uses absolute /cms/... paths → must mount at root (no prefix strip)
app.use(reportRoutes);

// Admin routes — Roles, Permissions, Menus, Settings, Tasks, Logs
app.use('/api', adminRoutes);
app.use('/cms', adminRoutes);

// Master Setup routes — TypePayment, Countries, Cities, Holidays
app.use('/api', masterSetupRoutes);
app.use('/cms', masterSetupRoutes);

// Company Profile routes — Sales & Marketing
app.use('/api', companyRoutes);
app.use('/cms', companyRoutes);

// Housekeeping routes — Phase 4.8
app.use('/api', housekeepingRoutes);
app.use('/cms', housekeepingRoutes);

// Concierge routes — Phase 4.8
app.use('/api', conciergeRoutes);
app.use('/cms', conciergeRoutes);

// Event Management routes — Phase 4.8
app.use('/api', eventRoutes);
app.use('/cms', eventRoutes);

// Statistic routes — Phase 4.8
app.use('/api', statisticRoutes);
app.use('/cms', statisticRoutes);

// Generic CRUD routes — Phase 5.2 (auto-generates list/create/show/update/delete/restore for any model)
app.use('/api/generic', genericRoutes);
app.use('/cms/generic', genericRoutes);

// Extra modules — allotment, overbooking, yield, competitor, statistic/occupancy, countryByRegion, email
app.use('/api', extraRoutes);
app.use('/cms', extraRoutes);

// Content module — Phase 8 (contents, banners, cancelation rules, emails, other-guests)
app.use('/api', contentRoutes);
app.use('/cms', contentRoutes);

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

export default app;
