import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

interface RouteInfo {
  method: string;
  path: string;
  handler: string;
  file: string;
  isGeneric: boolean;
  genericModel?: string;
}

interface CrudParity {
  route: string;
  list: string;
  show: string;
  create: string;
  update: string;
  delete: string;
  backend_file: string;
}

const PRISMA_MODELS = new Set([
  'accountings', 'allocation_accountings', 'allotments', 'approval_matrices', 'auto_transfers',
  'baggages', 'bar_inclusives', 'bar_rates', 'bars', 'batch_report', 'billing_tos',
  'cancelation_rule_dates', 'cancelation_rules', 'car_parks', 'channel_manager_interfaces',
  'channel_manager_rate_plans', 'channel_manager_room_types', 'cities', 'code_billings',
  'code_gls', 'code_items', 'code_posts', 'companies', 'company_contract_rate',
  'company_guests', 'company_profile_activities', 'company_profile_ar_transactions',
  'company_profile_billing_logs', 'company_profile_billing_setups', 'company_profile_contact_persons',
  'company_profile_customed_onlines', 'company_profile_departments', 'company_profile_documents',
  'company_profile_statistics', 'company_profiles', 'content_banners', 'content_breakdowns',
  'content_optional_items', 'content_room_breakdowns', 'content_room_facilities',
  'content_room_images', 'content_rooms', 'contents', 'countries', 'credit_limit_histories',
  'debugs', 'deposit_events', 'deposit_payments', 'doorlock_configs', 'doorlock_duplicate_counters',
  'dynamic_rate_configs', 'dynamic_rate_results', 'email_builders', 'email_groups',
  'event_capacities', 'event_deposit_actuals', 'event_deposit_plans', 'event_event_items',
  'event_events', 'event_instructions', 'event_inventories', 'event_layouts',
  'event_management_items', 'event_managements', 'event_package_items', 'event_packages',
  'event_venues', 'event_venues_layouts', 'failed_jobs', 'folios', 'guest_profile_documents',
  'guest_profile_family_members', 'guest_profile_histories', 'guest_profile_loyalty_cards',
  'guest_profile_preferences', 'guest_profile_request_notes', 'guest_profiles', 'holidays',
  'hotel_competitors', 'housekeeper_history', 'housekeeper_history_user',
  'housekeeping_history_checklists', 'housekeeping_setup_room_types', 'housekeeping_setup_rooms',
  'housekeeping_setups', 'jobs', 'last_user_folios', 'ledgers', 'log_audits', 'logs',
  'lost_and_founds', 'map_logs', 'master_hotel_competitors', 'menus', 'messages',
  'migrations', 'model_has_code_items', 'model_has_companies', 'model_has_company_profiles',
  'model_has_menus', 'model_has_packages', 'model_has_permissions', 'model_has_promotions',
  'model_has_properties', 'model_has_rate_inclusives', 'model_has_rates', 'model_has_roles',
  'model_has_rosters', 'model_has_types', 'other_guests', 'overbookings', 'packages',
  'password_reset_tokens', 'payment_matrices', 'permissions', 'personal_access_tokens',
  'phone_book_groups', 'phone_books', 'pos_matrix_sales', 'post_code_budgets',
  'promotions', 'properties', 'rate_configs', 'rate_day_uses', 'rate_extra_bed_inclusives',
  'rate_inclusives', 'rate_link_listings', 'rate_rates', 'rates', 'regions',
  'report_pax_room_solds', 'report_permissions', 'report_revenue_breakfast',
  'report_revenue_dine_in', 'report_revenue_fb_other', 'report_revenue_fb_others',
  'report_revenue_minimarts', 'report_revenue_room_banquet_others', 'report_revenue_room_services',
  'requests', 'reservation_items', 'reservation_rate_histories', 'reservations',
  'role_menu_crud', 'role_permissions', 'role_templates', 'roles', 'room_allotments',
  'room_availabilities', 'room_change_histories', 'room_inventories', 'room_type_image',
  'room_types', 'rooms', 'roster_list', 'rosters', 'schedule_employees', 'settings',
  'shift_postings', 'shift_roster', 'shift_user_list', 'shifts', 'staah_interfaces',
  'staah_ota_company_mappings', 'staah_rate_mappings', 'staah_reservations',
  'staah_room_content_breakdowns', 'staah_room_mappings', 'staah_sync_logs', 'states',
  'statistic_messages', 'statistic_rate_codes', 'stocks', 'stop_sells', 'subregions',
  'system_balances', 'task_reads', 'tasks', 'third_party_logs', 'transaction_breakdowns',
  'transaction_pos_details', 'transaction_temps', 'transactions', 'type_payments', 'types',
  'users', 'wake_up_calls', 'work_order_stocks', 'work_orders', 'yields'
]);

function modelToRoute(model: string): string {
  return model.replace(/_/g, '-');
}

function loadGenericMappings(): { kebabOverrides: Record<string, string>; irregular: Record<string, string> } {
  const genericControllerPath = join(__dirname, '..', 'src', 'controllers', 'generic.controller.ts');
  const content = readFileSync(genericControllerPath, 'utf-8');
  
  const kebabOverrides: Record<string, string> = {};
  const kebabMatch = content.match(/const kebabOverrides: Record<string, string> = \{([\s\S]*?)\};/);
  if (kebabMatch) {
    const overrideContent = kebabMatch[1];
    const overrideRegex = /'([^']+)'\s*:\s*'([^']+)'/g;
    let om;
    while ((om = overrideRegex.exec(overrideContent)) !== null) {
      kebabOverrides[om[1]] = om[2];
    }
  }

  const irregular: Record<string, string> = {};
  const irregularMatch = content.match(/const irregular: Record<string, string> = \{([\s\S]*?)\};/);
  if (irregularMatch) {
    const irregularContent = irregularMatch[1];
    const irregularRegex = /'([^']+)'\s*:\s*'([^']+)'/g;
    let im;
    while ((im = irregularRegex.exec(irregularContent)) !== null) {
      irregular[im[1]] = im[2];
    }
  }

  return { kebabOverrides, irregular };
}

function extractRoutesFromFile(filePath: string): RouteInfo[] {
  const content = readFileSync(filePath, 'utf-8');
  const routes: RouteInfo[] = [];
  const fileName = filePath.split(/[\\/]/).pop() || '';

  // Standard router.METHOD patterns - capture method, path, and handler
  const routeRegex = /router\.(get|post|put|patch|delete|use)\s*\(\s*['"`]([^'"`]+)['"`](?:\s*,\s*([^)]+))?\)/g;
  let match;
  while ((match = routeRegex.exec(content)) !== null) {
    const method = match[1].toUpperCase();
    const path = match[2];
    const handler = (match[3] || '').trim();
    
    // Check if handler uses generic controller
    const isGeneric = handler.includes('generic.') || handler.includes('genericController');
    let genericModel: string | undefined;
    if (isGeneric) {
      // Try to extract model from req.params.model = 'xxx' in the handler
      const modelMatch = handler.match(/req\.params\.model\s*=\s*['"`]([^'"`]+)['"`]/);
      if (modelMatch) {
        genericModel = modelMatch[1];
      } else {
        // Also check for const X = (req) => { req.params.model = 'xxx'; }
        const constMatch = content.match(new RegExp(`const\\s+\\w+\\s*=\\s*\\(req[^)]*\\)\\s*=>\\s*\\{[^}]*req\\.params\\.model\\s*=\\s*['"]([^'"]+)['"]`));
        if (constMatch) {
          genericModel = constMatch[1];
        }
      }
    }

    routes.push({
      method,
      path,
      handler,
      file: fileName,
      isGeneric,
      genericModel,
    });
  }

  // Also catch generic routes from generic.routes.ts
  const genericRouteRegex = /router\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*ctrl\.\w+/g;
  while ((match = genericRouteRegex.exec(content)) !== null) {
    routes.push({
      method: match[1].toUpperCase(),
      path: match[2],
      handler: 'genericController',
      file: fileName,
      isGeneric: true,
      genericModel: ':model',
    });
  }

  return routes;
}

function getFullRoute(path: string): string {
  const parts = path.split('/').filter(p => p);
  if (parts.length >= 2 && (parts[0] === 'cms' || parts[0] === 'api')) {
    return parts.slice(1).join('/');
  }
  return parts.join('/');
}

function normalizeRoutePath(path: string): string {
  // Convert :param to * for matching
  return path.replace(/:([^/]+)/g, '*');
}

function extractBaseRouteAndCrud(method: string, path: string): { baseRoute: string; crud: string } | null {
  const normalized = path.replace(/^[\/]+/, '');
  const parts = normalized.split('/');
  
  if (normalized.startsWith('generic/')) {
    const modelPart = parts.slice(1).join('/');
    let crud: string | null = null;
    if (method === 'GET' && modelPart === ':model') crud = 'list';
    else if (method === 'POST' && modelPart === ':model') crud = 'create';
    else if (method === 'GET' && modelPart === ':model/create') crud = 'create';
    else if (method === 'GET' && modelPart.match(/^:model\/[^/]+\/update$/)) crud = 'update';
    else if (method === 'GET' && modelPart.match(/^:model\/[^/]+$/)) crud = 'show';
    else if (method === 'PUT' && modelPart.match(/^:model\/[^/]+$/)) crud = 'update';
    else if (method === 'DELETE' && modelPart.match(/^:model\/[^/]+$/)) crud = 'delete';
    else if (method === 'POST' && modelPart.match(/^:model\/[^/]+\/restore$/)) crud = 'restore';
    
    if (crud) {
      return { baseRoute: 'generic/:model', crud };
    }
    return null;
  }

  if (parts.length === 0) return null;
  
  const lastSegment = parts[parts.length - 1];
  const secondLastSegment = parts.length >= 2 ? parts[parts.length - 2] : null;
  
  let crud: string | null = null;
  let baseRouteParts = [...parts];
  
  // GET /route or GET /route/ → list
  if (method === 'GET' && (lastSegment === '' || (!lastSegment.startsWith(':') && lastSegment !== 'create' && lastSegment !== 'update' && lastSegment !== 'edit' && !lastSegment.startsWith(':id')))) {
    const isBaseRoute = !['create', 'update', 'edit'].includes(lastSegment) && 
                        !lastSegment.startsWith(':') &&
                        !(secondLastSegment && secondLastSegment.startsWith(':'));
    if (isBaseRoute) {
      crud = 'list';
    }
  }
  
  // POST /route → create
  if (method === 'POST') {
    const isBaseRoute = !['create', 'update', 'edit'].includes(lastSegment) && 
                        !lastSegment.startsWith(':') &&
                        !(secondLastSegment && secondLastSegment.startsWith(':'));
    if (isBaseRoute) {
      crud = 'create';
    }
  }
  
  // GET /route/create → create form
  if (method === 'GET' && lastSegment === 'create') {
    crud = 'create';
    baseRouteParts = parts.slice(0, -1);
  }
  
  // GET /route/:id → show
  if (method === 'GET' && lastSegment.startsWith(':')) {
    crud = 'show';
    baseRouteParts = parts.slice(0, -1);
  }
  
  // GET /route/:id/update or /route/:id/edit → update form
  if (method === 'GET' && (lastSegment === 'update' || lastSegment === 'edit') && secondLastSegment?.startsWith(':')) {
    crud = 'update';
    baseRouteParts = parts.slice(0, -2);
  }
  
  // PUT /route/:id → update
  if (method === 'PUT' && lastSegment.startsWith(':')) {
    crud = 'update';
    baseRouteParts = parts.slice(0, -1);
  }
  
  // DELETE /route/:id → delete
  if (method === 'DELETE' && lastSegment.startsWith(':')) {
    crud = 'delete';
    baseRouteParts = parts.slice(0, -1);
  }
  
  // POST /route/:id/restore → restore
  if (method === 'POST' && lastSegment === 'restore' && secondLastSegment?.startsWith(':')) {
    crud = 'restore';
    baseRouteParts = parts.slice(0, -2);
  }

  if (!crud) return null;
  
  const baseRoute = baseRouteParts.join('/');
  return { baseRoute, crud };
}

function main() {
  const routesDir = join(__dirname, '..', 'src', 'routes');
  const routeFiles = readdirSync(routesDir).filter(f => f.endsWith('.routes.ts'));

  const allRoutes: RouteInfo[] = [];
  
  for (const file of routeFiles) {
    const filePath = join(routesDir, file);
    const routes = extractRoutesFromFile(filePath);
    allRoutes.push(...routes);
  }

  const indexPath = join(__dirname, '..', 'src', 'index.ts');
  const indexContent = readFileSync(indexPath, 'utf-8');

  const mountRegex = /app\.use\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*(\w+)/g;
  const mountPoints: Record<string, string> = {};
  let match;
  while ((match = mountRegex.exec(indexContent)) !== null) {
    const prefix = match[1].replace(/^\/+/, '').replace(/\/+$/, '');
    const routerVar = match[2];
    mountPoints[routerVar] = prefix;
  }

  const { kebabOverrides, irregular } = loadGenericMappings();

  // Manually defined routes that use generic controller (from route file analysis)
  const manualGenericRoutes = new Map<string, string>([
    // housekeeping.routes.ts
    ['housekeeping/rosters', 'rosters'],
    ['housekeeping/rosters/create', 'rosters'],
    ['housekeeping/rosters/:id', 'rosters'],
    ['housekeeping/rosters/:id/update', 'rosters'],
    ['housekeeping/roster-list', 'roster_list'],
    ['housekeeping/roster-list/create', 'roster_list'],
    ['housekeeping/roster-list/:id', 'roster_list'],
    ['housekeeping/roster-list/:id/update', 'roster_list'],
    ['housekeeping/shift-roster', 'shift_roster'],
    ['housekeeping/shift-roster/create', 'shift_roster'],
    ['housekeeping/shift-roster/:id', 'shift_roster'],
    ['housekeeping/shift-roster/:id/update', 'shift_roster'],
    ['housekeeping/stock', 'stocks'],
    ['housekeeping/stock/:id', 'stocks'],
    ['housekeeping/service-scheduler', 'rosters'],
    ['housekeeping/service-scheduler/create', 'rosters'],
    ['housekeeping/service-scheduler/:id', 'rosters'],
    ['housekeeping/service-scheduler/:id/update', 'rosters'],
    ['stock', 'stocks'],
    ['stock/:id', 'stocks'],
    ['work-order-stock', 'work_order_stocks'],
    ['work-order-stock/:id', 'work_order_stocks'],
    // extra.routes.ts
    ['stop-sell-booking', 'stop_sells'],
    ['stop-sell-booking/create', 'stop_sells'],
    ['stop-sell-booking/:id/update', 'stop_sells'],
    ['channel-manager-interface', 'channel_manager_interfaces'],
    ['channel-manager-interface/create', 'channel_manager_interfaces'],
    ['channel-manager-interface/:id/update', 'channel_manager_interfaces'],
    ['content-room', 'content_rooms'],
    ['content-room/create', 'content_rooms'],
    ['content-room/:id/update', 'content_rooms'],
    ['rate-room', 'rates'],
    ['rate-room/:id/update', 'rates'],
    ['payment-matrix', 'payment_matrices'],
    ['payment-matrix/create', 'payment_matrices'],
    ['payment-matrix/:id/update', 'payment_matrices'],
    ['staah-manager', 'staah_interfaces'],
    ['staah-manager/create', 'staah_interfaces'],
    ['staah-manager/:id/update', 'staah_interfaces'],
    ['staah-reservation', 'staah_reservations'],
    ['staah-reservation/:id', 'staah_reservations'],
    ['staah-ota-mapping', 'staah_ota_company_mappings'],
    ['staah-ota-mapping/create', 'staah_ota_company_mappings'],
    ['staah-ota-mapping/:id/update', 'staah_ota_company_mappings'],
    ['allotment/room', 'room_allotments'],
    ['allotment-room', 'room_allotments'],
    ['allotment', 'allotment'],
    ['allotment/create', 'allotment'],
    ['allotment/:id', 'allotment'],
    ['allotment/:id/update', 'allotment'],
    ['allotments', 'allotment'],
    ['allotments/create', 'allotment'],
    ['allotments/:id', 'allotment'],
    ['allotments/:id/update', 'allotment'],
    ['overbooking', 'overbooking'],
    ['overbooking/create', 'overbooking'],
    ['overbooking/:id', 'overbooking'],
    ['overbooking/:id/update', 'overbooking'],
    ['overbookings', 'overbooking'],
    ['overbookings/create', 'overbooking'],
    ['overbookings/:id', 'overbooking'],
    ['overbookings/:id/update', 'overbooking'],
    ['yield', 'yield'],
    ['yield/create', 'yield'],
    ['yield/:id', 'yield'],
    ['yield/:id/update', 'yield'],
    ['yield/:id/edit', 'yield'],
    ['yields', 'yield'],
    ['yields/create', 'yield'],
    ['yields/:id', 'yield'],
    ['yields/:id/update', 'yield'],
    ['yields/:id/edit', 'yield'],
    ['hotel-competitor', 'hotel_competitor'],
    ['hotel-competitor/:id', 'hotel_competitor'],
    ['hotel-competitors', 'hotel_competitor'],
    ['hotel-competitors/:id', 'hotel_competitor'],
    ['master-hotel-competitor', 'master_hotel_competitor'],
    ['master-hotel-competitor/:id', 'master_hotel_competitor'],
    ['master-hotel-competitors', 'master_hotel_competitor'],
    ['master-hotel-competitors/:id', 'master_hotel_competitor'],
    ['profile/guest', 'guest_profiles'],
    ['profile/guest/create', 'guest_profiles'],
    ['profile/guest/:id/update', 'guest_profiles'],
    // content.routes.ts (check for generic usage)
    // admin.routes.ts (generic routes at /generic/:model)
    // concierge.routes.ts (check for generic usage)
  ]);

  // Build reverse mapping: Prisma model -> frontend kebab-case route
  const modelToFrontendRoute = new Map<string, string>();
  for (const model of PRISMA_MODELS) {
    let frontendRoute = modelToRoute(model);
    for (const [fe, be] of Object.entries(kebabOverrides)) {
      if (be === model) {
        frontendRoute = fe;
        break;
      }
    }
    for (const [fe, be] of Object.entries(irregular)) {
      if (be === model) {
        frontendRoute = fe;
        break;
      }
    }
    modelToFrontendRoute.set(model, frontendRoute);
  }

  // Build set of all frontend routes covered by generic (via kebabOverrides/irregular)
  const genericFrontendRoutes = new Set<string>();
  for (const [model, feRoute] of modelToFrontendRoute) {
    genericFrontendRoutes.add(feRoute);
    if (feRoute.endsWith('s')) {
      genericFrontendRoutes.add(feRoute.slice(0, -1));
    } else {
      genericFrontendRoutes.add(feRoute + 's');
    }
  }

  // Add manually identified generic-backed routes
  for (const [routePath, model] of manualGenericRoutes) {
    const feRoute = modelToRoute(model);
    genericFrontendRoutes.add(feRoute);
    genericFrontendRoutes.add(routePath); // Also add the full path
    if (feRoute.endsWith('s')) {
      genericFrontendRoutes.add(feRoute.slice(0, -1));
    } else {
      genericFrontendRoutes.add(feRoute + 's');
    }
  }

  // Also add routes that explicitly use generic controller in route files
  for (const route of allRoutes) {
    if (route.isGeneric && route.genericModel && route.genericModel !== ':model') {
      const feRoute = modelToRoute(route.genericModel);
      genericFrontendRoutes.add(feRoute);
      if (feRoute.endsWith('s')) {
        genericFrontendRoutes.add(feRoute.slice(0, -1));
      } else {
        genericFrontendRoutes.add(feRoute + 's');
      }
    }
  }

  // Categorize all routes by their base route
  const routeMap: Record<string, { list: boolean; show: boolean; create: boolean; update: boolean; delete: boolean; restore: boolean; files: Set<string> }> = {};

  for (const route of allRoutes) {
    let fullPath = route.path;
    const prefix = mountPoints[route.file.replace('.routes.ts', '')] || '';
    if (prefix) {
      fullPath = `${prefix}/${route.path}`.replace(/\/+/g, '/');
    }

    const extracted = extractBaseRouteAndCrud(route.method, fullPath);
    if (!extracted) continue;

    const { baseRoute, crud } = extracted;
    const fullBaseRoute = getFullRoute(baseRoute);

    if (!routeMap[fullBaseRoute]) {
      routeMap[fullBaseRoute] = { list: false, show: false, create: false, update: false, delete: false, restore: false, files: new Set() };
    }
    (routeMap[fullBaseRoute] as any)[crud] = true;
    routeMap[fullBaseRoute].files.add(route.file);
  }

  // Scan frontend for GLOBALURI usage
  const frontendDir = join(__dirname, '..', '..', 'frontend-node');
  const frontendRoutes = new Set<string>();
  
  function scanFrontendDir(dir: string) {
    try {
      const files = readdirSync(dir);
      for (const file of files) {
        const fullPath = join(dir, file);
        const stat = require('fs').statSync(fullPath);
        if (stat.isDirectory()) {
          scanFrontendDir(fullPath);
        } else if (file.endsWith('.tsx') || file.endsWith('.ts')) {
          const content = readFileSync(fullPath, 'utf-8');
          const globalUriMatches = content.match(/GLOBALURI\s*=\s*["'`]([^"'`]+)["'`]/g);
          if (globalUriMatches) {
            for (const m of globalUriMatches) {
              const uriMatch = m.match(/["'`]([^"'`]+)["'`]/);
              if (uriMatch) {
                let uri = uriMatch[1];
                uri = uri.replace(/^\/cms\//, '').replace(/^\/api\//, '');
                uri = uri.split('?')[0];
                frontendRoutes.add(uri);
              }
            }
          }
        }
      }
    } catch (e) {
      // Ignore errors
    }
  }

  scanFrontendDir(frontendDir);

  const uniqueFrontendRoutes = [...frontendRoutes].sort();

  // Build parity report
  const parityRows: CrudParity[] = [];

  for (const feRoute of uniqueFrontendRoutes) {
    const fullRoute = getFullRoute(feRoute);
    // Try exact match first
    let beInfo = routeMap[fullRoute];
    // If no exact match, try to find a matching base route
    if (!beInfo) {
      for (const [bePath, info] of Object.entries(routeMap)) {
        if (bePath === fullRoute || normalizeRoutePath(bePath) === normalizeRoutePath(fullRoute)) {
          beInfo = info;
          break;
        }
      }
    }
    const isGeneric = genericFrontendRoutes.has(fullRoute) || genericFrontendRoutes.has(feRoute);

    const list = beInfo?.list || isGeneric ? 'yes' : 'no';
    const show = beInfo?.show || isGeneric ? 'yes' : 'no';
    const create = beInfo?.create || isGeneric ? 'yes' : 'no';
    const update = beInfo?.update || isGeneric ? 'yes' : 'no';
    const delete_ = beInfo?.delete || isGeneric ? 'yes' : 'no';
    const backendFile = beInfo ? Array.from(beInfo.files).join(', ') : (isGeneric ? 'generic.routes.ts' : '');

    parityRows.push({
      route: feRoute,
      list,
      show,
      create,
      update,
      delete: delete_,
      backend_file: backendFile,
    });
  }

  // Also add backend-only routes that have CRUD but no frontend usage
  for (const [fullBaseRoute, info] of Object.entries(routeMap)) {
    if (!uniqueFrontendRoutes.some(f => getFullRoute(f) === fullBaseRoute || normalizeRoutePath(getFullRoute(f)) === normalizeRoutePath(fullBaseRoute))) {
      parityRows.push({
        route: fullBaseRoute,
        list: info.list ? 'yes' : 'no',
        show: info.show ? 'yes' : 'no',
        create: info.create ? 'yes' : 'no',
        update: info.update ? 'yes' : 'no',
        delete: info.delete ? 'yes' : 'no',
        backend_file: Array.from(info.files).join(', '),
      });
    }
  }

  // Sort by route name
  parityRows.sort((a, b) => a.route.localeCompare(b.route));

  // Write CSV
  const csvHeader = 'route,list,show,create,update,delete,backend_file\n';
  const csvRows = parityRows.map(r => 
    `${r.route},${r.list},${r.show},${r.create},${r.update},${r.delete},${r.backend_file}`
  ).join('\n');
  
  const outputPath = join(__dirname, '..', 'migration_reports', 'frontend_crud_parity_v2.csv');
  writeFileSync(outputPath, csvHeader + csvRows + '\n');
  
  console.log(`Generated ${parityRows.length} rows in ${outputPath}`);
  
  // Print summary
  const covered = parityRows.filter(r => r.list === 'yes').length;
  const total = parityRows.length;
  console.log(`Coverage: ${covered}/${total} (${((covered/total)*100).toFixed(1)}%) list routes covered`);
  
  // Show generic-covered routes
  const genericCovered = parityRows.filter(r => r.backend_file === 'generic.routes.ts' || r.backend_file.includes('generic'));
  console.log(`\nGeneric-covered routes (${genericCovered.length}):`);
  for (const r of genericCovered.slice(0, 50)) {
    console.log(`  ${r.route}: list=${r.list} show=${r.show} create=${r.create} update=${r.update} delete=${r.delete} [${r.backend_file}]`);
  }
  if (genericCovered.length > 50) {
    console.log(`  ... and ${genericCovered.length - 50} more`);
  }

  // Show routes with no CRUD
  const noCrud = parityRows.filter(r => r.list === 'no' && r.show === 'no' && r.create === 'no' && r.update === 'no' && r.delete === 'no');
  console.log(`\nRoutes with NO CRUD (${noCrud.length}):`);
  for (const r of noCrud.slice(0, 30)) {
    console.log(`  ${r.route} [${r.backend_file}]`);
  }
  if (noCrud.length > 30) {
    console.log(`  ... and ${noCrud.length - 30} more`);
  }
}

main();