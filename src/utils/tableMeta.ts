// Shared list metadata replicating Laravel formatTable()/paging()/permission patterns.
import { Request } from 'express';

export const STATUS_OPTIONS = [
  { value: 1, label: 'Active' },
  { value: 0, label: 'Inactive' },
];

export function laravelPaging(total: number, limit: number, page: number): Record<string, number> {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return {
    limit_data: limit,
    total_data: total,
    start_paging: page,
    end_paging: totalPages,
    prev_jump: page > 1 ? 1 : 0,
    prev: page > 1 ? page - 1 : 0,
    next: page < totalPages ? page + 1 : 0,
    next_jump: page < totalPages ? totalPages : 0,
  };
}

export function listPermission(req: Request, flags?: { add?: boolean; edit?: boolean; delete?: boolean }) {
  const superUser = !!(req.user as any)?.superUser;
  return {
    view: true,
    add: superUser || !!flags?.add,
    edit: superUser || !!flags?.edit,
    delete: superUser || !!flags?.delete,
  };
}

export function crudPermission(user: any, menuId: bigint): { add: boolean; edit: boolean; delete: boolean } {
  if (user?.superUser) return { add: true, edit: true, delete: true };
  const crud = user?.permissions?.get(menuId);
  return { add: !!crud?.add, edit: !!crud?.edit, delete: !!crud?.delete };
}

const STATUS_COL = (): any => ({
  label: 'Status',
  key: 'status',
  type: 'checkbox',
  options: STATUS_OPTIONS,
  is_search: true,
});

const NO_COL = (): any => ({ label: 'No', key: 'no', type: 'none', is_search: false });

export const TABLES: Record<string, any[]> = {
  room: [
    { label: 'No', key: 'sort', type: 'number', is_search: false },
    { label: 'Name', key: 'name', type: 'text', is_search: true },
    { label: 'Room Type', key: 'room_type_id', type: 'number', is_search: true },
    { label: 'Status', key: 'room_status', type: 'checkbox', is_search: true },
    { label: 'Maid Status', key: 'maid_status', type: 'select', is_search: true },
    { label: 'Map ID', key: 'map_id', type: 'text', is_search: false },
    { label: 'Max Pax', key: 'max_pax', type: 'number', is_search: false },
    { label: 'Total Bed', key: 'total_bed', type: 'number', is_search: false },
    { label: 'TV', key: 'with_tv', type: 'checkbox', is_search: false },
    { label: 'Shower', key: 'with_shower', type: 'checkbox', is_search: false },
  ],
  role: [
    STATUS_COL(),
    { label: 'Name', key: 'name', type: 'text', is_search: true },
    { label: 'Code', key: 'code', type: 'text', is_search: true },
  ],
  user: [
    NO_COL(),
    STATUS_COL(),
    { label: 'Name', key: 'name', type: 'text', is_search: true },
    { label: 'Email', key: 'email', type: 'text', is_search: true },
    { label: 'Phone', key: 'phone', type: 'text', is_search: true },
    { label: 'Is Login', key: 'is_online', type: 'checkbox', is_search: false },
    { label: 'Force Logout', key: 'force_logout', is_button_logout: true, type: 'text', is_search: false },
  ],
  property: [
    { label: 'Status', key: 'status' },
    { label: 'Name', key: 'name' },
    { label: 'Total Room', key: 'room_count' },
    { label: 'Contract/Subscription Type', key: 'subscribe_types' },
    { label: 'Join Date', key: 'join_date', type: 'date' },
    { label: 'White List IP', key: 'whitelist_ip' },
    { label: 'City', key: 'city' },
    { label: 'Image', key: 'image' },
  ],
  company: [
    STATUS_COL(),
    { label: 'Name', key: 'name', type: 'text', is_search: true },
    { label: 'Email', key: 'email', type: 'text', is_search: true },
    { label: 'Join Date', key: 'join_date', type: 'date', is_search: true },
    { label: 'NPWP', key: 'npwp', type: 'text', is_search: true },
    { label: 'No Tlp', key: 'no_tlp', type: 'text', is_search: true },
    { label: 'PIC Name', key: 'pic_name', type: 'text', is_search: true },
    { label: 'Properties', key: 'properties' },
  ],
  codeBilling: [
    NO_COL(),
    STATUS_COL(),
    { label: 'Billing Code', key: 'name', type: 'text', is_search: true },
    { label: 'Description', key: 'description', type: 'text', is_search: true },
    { label: 'Order', key: 'sort', type: 'number', is_search: false },
  ],
  codePost: [
    NO_COL(),
    STATUS_COL(),
    { label: 'Post Code POS', key: 'is_pos', type: 'checkbox', is_search: true },
    { label: 'Post Code', key: 'name', type: 'text', is_search: true },
    { label: 'Type', key: 'type', type: 'select', is_search: true },
    { label: 'Billing Code', key: 'code_billing_id', type: 'select', is_search: true },
    { label: 'GL Code', key: 'code_gl_id', type: 'select', is_search: true },
  ],
  codeItem: [
    NO_COL(),
    STATUS_COL(),
    { label: 'Item Code', key: 'name', type: 'text', is_search: true },
    { label: 'Post Code', key: 'code_post_id', type: 'select', is_search: true },
    { label: 'Online', key: 'is_online', type: 'checkbox', is_search: false },
    { label: 'Event', key: 'is_event', type: 'checkbox', is_search: false },
    { label: 'Description', key: 'description', type: 'text', is_search: true },
    { label: 'Sales', key: 'sales', type: 'number', is_search: true },
    { label: 'Cost', key: 'cost', type: 'number', is_search: true },
  ],
  codeGl: [
    NO_COL(),
    STATUS_COL(),
    { label: 'Code', key: 'name', type: 'text', is_search: true },
    { label: 'Description', key: 'description', type: 'text', is_search: true },
  ],
  typePayment: [
    NO_COL(),
    STATUS_COL(),
    { label: 'Payment Type', key: 'name', type: 'text', is_search: true },
    { label: 'Post Code', key: 'code_post_id', type: 'select', is_search: true },
    { label: 'Company AR', key: 'is_company_ar', type: 'checkbox', is_search: false },
    { label: 'Payment for AR', key: 'is_payment_ar', type: 'checkbox', is_search: false },
    { label: 'Company', key: 'company_id', type: 'autocomplete', url_autocomplete: '/cms/profile/company-v2', is_search: true },
  ],
  holiday: [
    NO_COL(),
    STATUS_COL(),
    { label: 'Start Date', key: 'start_date', type: 'date', is_search: true },
    { label: 'End Date', key: 'end_date', type: 'date', is_search: true },
    { label: 'Name', key: 'name', type: 'text', is_search: true },
  ],
  yield: [
    NO_COL(),
    STATUS_COL(),
    { label: 'Is General', key: 'is_general', type: 'checkbox', is_search: false },
    { label: 'Room Type', key: 'room_type_id', type: 'select', is_search: true },
    { label: 'Start Date', key: 'start_date', type: 'date', is_search: true },
    { label: 'End Date', key: 'end_date', type: 'date', is_search: true },
    { label: 'Min Rate', key: 'min_rate', type: 'number', is_search: false },
    { label: 'Occupancy From', key: 'occupancy_from', type: 'number', is_search: false },
    { label: 'Occupancy To', key: 'occupancy_to', type: 'number', is_search: false },
  ],
  // Company profile submenu tabs (company_id filtered) — CompanyProfileDepartment formatTable parity
  companyDepartment: [
    { label: 'Department', key: 'department', type: 'text', is_search: true },
    { label: 'Address', key: 'address', type: 'text', is_search: true },
  ],
  // CompanyProfileActivity formatTable parity (company_follow_up/company_activity select cols have no DB column in node)
  companyActivity: [
    { label: 'Date', key: 'date', type: 'date', is_search: true },
    { label: 'Subject', key: 'subject', type: 'text', is_search: true },
    { label: 'Objective', key: 'objective', type: 'text', is_search: true },
  ],
  // CompanyProfileDocument formatTable parity
  companyDocument: [
    { label: 'File', key: 'file', type: 'file_document', is_search: false },
    { label: 'Description', key: 'description', type: 'text', is_search: true },
  ],
  // CompanyGuest formatTable parity
  companyGuest: [
    { label: 'Account', key: 'id', type: 'none', is_search: false },
    { label: 'First Name', key: 'first_name', type: 'text', is_search: true },
    { label: 'Last Name', key: 'last_name', type: 'text', is_search: true },
    { label: 'Email', key: 'email', type: 'text', is_search: true },
    { label: 'Mobile Phone', key: 'mobile_phone', type: 'text', is_search: true },
  ],
  // CompanyProfileStatistic formatTable parity (aggregate from folios+reservations per month)
  companyStatistic: [
    { label: 'Month', key: 'month', type: 'text', is_search: true },
    { label: 'Number of Night', key: 'room_night', type: 'text', is_search: true },
    { label: 'Room Revenue', key: 'room_revenue', type: 'text', is_search: true },
    { label: 'ARR', key: 'arr', type: 'text', is_search: true },
  ],
  // CompanyProfileBillingSetup formatTable parity (row per active code_billing)
  companyBillingSetup: [
    { label: 'Billing Code', key: 'code_billing_id', type: 'none', is_search: false },
    { label: 'Billing', key: 'billing', type: 'number', is_search: false },
  ],
  // CompanyProfileContactPerson formatTable parity (department options injected per company_id)
  companyContact: [
    STATUS_COL(),
    { label: 'Name', key: 'name', type: 'text', is_search: true },
    { label: 'Email', key: 'email', type: 'text', is_search: true },
    { label: 'Position', key: 'position', type: 'text', is_search: true },
    { label: 'Department', key: 'department', type: 'select', is_search: true },
    { label: 'Mobile Phone', key: 'mobile_phone', type: 'text', is_search: true },
  ],
  // Baggage formatTable parity (concierge/baggage)
  baggage: [
    NO_COL(),
    STATUS_COL(),
    { label: 'Date', key: 'date', type: 'date', is_search: true },
    { label: 'Name', key: 'name', type: 'text', is_search: true },
    { label: 'Phone number', key: 'phone_number', type: 'text', is_search: true },
    { label: 'Tag No', key: 'tag_no', type: 'text', is_search: true },
    { label: 'Image', key: 'file', type: 'file_document', is_search: false },
    { label: 'Remark', key: 'remark', type: 'text', is_search: true },
  ],
  guestDocument: [
    { label: 'File', key: 'file', type: 'file_document', is_search: false },
    { label: 'Description', key: 'description', type: 'text', is_search: true },
    { label: 'Status', key: 'status', type: 'checkbox', options: [{ value: 1, label: 'Active' }, { value: 0, label: 'Inactive' }], is_search: true },
  ],
  guestFolio: [
    { label: 'Folio', key: 'folio_number', type: 'text', is_search: true },
    { label: 'Check In', key: 'check_in_date', type: 'date', is_search: true },
    { label: 'Check Out', key: 'check_out_date', type: 'date', is_search: true },
    { label: 'Status', key: 'status', type: 'checkbox', is_search: true },
  ],
  hotelCompetitor: [
    { label: 'Date', key: 'date', type: 'date', is_search: true },
    { label: 'Hotel Competitor', key: 'master_hotel_competitor_id', type: 'select', is_search: true },
    { label: 'Room Available', key: 'room_available', type: 'number', is_search: false },
    { label: 'Room Sold', key: 'room_sold', type: 'number', is_search: false },
    { label: 'ARR', key: 'arr', type: 'number', is_search: false },
    { label: 'Total Revenue', key: 'total_revenue', type: 'number', is_search: false },
  ],
  roomAllotments: [
    { label: 'Room Type', key: 'room_type_id', type: 'select', is_search: true },
    { label: 'Amount', key: 'data', type: 'text', is_search: true },
  ],
  // ── Concierge (Laravel PhoneBookGroup{1,2,3}Controller + PhoneBookController
  //    + CarParkController + LostAndFoundController formatTable parity) ──
  //
  // These must be static definitions. The previous `buildDefaultTable(rows)`
  // derived the columns from Object.keys(rows[0]), so an EMPTY table produced
  // zero columns and the in-table add row rendered no inputs at all — and a
  // populated one exposed property_id / created_by / deleted_at as editable
  // string fields. `options` for the select columns are injected per request in
  // ConciergeController.
  phoneBookGroup1: [
    { label: 'Sort', key: 'no', type: 'none', is_search: true },
    { label: 'Name', key: 'name', type: 'text', is_search: true },
  ],
  // Level 2 and 3 add a Parent Group select, sourced from the level above.
  phoneBookGroup2: [
    { label: 'Sort', key: 'no', type: 'none', is_search: true },
    { label: 'Name', key: 'name', type: 'text', is_search: true },
    { label: 'Parent Group', key: 'parent_id', type: 'select', options: [], is_search: true },
  ],
  phoneBookGroup3: [
    { label: 'Sort', key: 'no', type: 'none', is_search: true },
    { label: 'Name', key: 'name', type: 'text', is_search: true },
    { label: 'Parent Group', key: 'parent_id', type: 'select', options: [], is_search: true },
  ],
  phoneBook: [
    { label: 'Sort', key: 'no', type: 'none', is_search: false },
    { label: 'Phone Name', key: 'name', type: 'text', is_search: true },
    { label: 'Address', key: 'address', type: 'text', is_search: true },
    { label: 'Telp', key: 'telp', type: 'text', is_search: true },
    { label: 'Fax', key: 'fax', type: 'text', is_search: false },
    { label: 'Email', key: 'email', type: 'text', is_search: false },
    { label: 'Contact Name', key: 'contact_name', type: 'text', is_search: false },
    { label: 'Remark', key: 'remark', type: 'text', is_search: false },
  ],
  carPark: [
    { label: 'Sort', key: 'no', type: 'none', is_search: true },
    { label: 'Car Park Lot', key: 'car_park_lot', type: 'text', is_search: true },
    { label: 'Vehicle No', key: 'vehicle_no', type: 'text', is_search: true },
    { label: 'Folio', key: 'folio', type: 'autocomplete', url_autocomplete: '/cms/reservation/folio', is_search: false },
    { label: 'Room', key: 'room', type: 'select', options: [], is_search: true },
    { label: 'Remark', key: 'remark', type: 'text', is_search: false },
  ],
  lostFound: [
    { label: 'Ref No', key: 'ref_no', type: 'text', is_search: true },
    { label: 'Status', key: 'status_lost', type: 'select', options: [], is_search: true },
    { label: 'Date lost', key: 'report_date', type: 'date', is_search: true },
    { label: 'Item name', key: 'item', type: 'text', is_search: true },
    { label: 'Item status', key: 'item_status', type: 'select', options: [], is_search: true },
    { label: 'Hotel location', key: 'hotel_location', type: 'text', is_search: true },
    { label: 'Description', key: 'item_description', type: 'text', is_search: true },
    { label: 'Owner of item', key: 'owner_item', type: 'text', is_search: true },
    { label: 'Folio', key: 'folio', type: 'text', is_search: false },
    { label: 'Room', key: 'room', type: 'select', options: [], is_search: true },
    { label: 'Contact number', key: 'contact_number', type: 'text', is_search: true },
    { label: 'Founder of Item', key: 'founder_of_item', type: 'text', is_search: true },
    { label: 'Contact number', key: 'contact_number_founder', type: 'text', is_search: true },
    { label: 'Item Description', key: 'item_description', type: 'text', is_search: true },
  ],
  master_hotel_competitors: [
    NO_COL(),
    { label: 'Name', key: 'name', type: 'text', is_search: true },
    { label: 'Sort', key: 'sort', type: 'number', is_search: false },
    STATUS_COL(),
  ],
  hotel_competitors: [
    NO_COL(),
    { label: 'Date', key: 'date', type: 'date', is_search: true },
    { label: 'Competitor', key: 'master_hotel_competitor_id', type: 'select', is_search: true },
    { label: 'Room Available', key: 'room_available', type: 'number', is_search: false },
    { label: 'Room Sold', key: 'room_sold', type: 'number', is_search: false },
    { label: 'ARR', key: 'arr', type: 'number', is_search: false },
    { label: 'Total Revenue', key: 'total_revenue', type: 'number', is_search: false },
  ],
  // Laravel app/Models/Message.php::formatTable
  messages: [
    { label: 'No', key: 'no', type: 'none', is_search: false },
    { label: 'Message', key: 'message', type: 'text', is_search: false },
    { label: 'From Name', key: 'from_name', type: 'text', is_search: false },
    { label: 'Is Open', key: 'is_open', type: 'checkbox', options: [{ value: 1, label: 'Yes' }, { value: 0, label: 'No' }], is_search: false },
    { label: 'Created By', key: 'created_by', type: 'none', is_search: false },
    { label: 'Updated By', key: 'updated_by', type: 'none', is_search: false },
    { label: 'Closed By', key: 'closed_by', type: 'none', is_search: false },
    { label: 'Date', key: 'date', type: 'none', is_search: false },
  ],
  // Laravel app/Models/Package.php::formatTable
  packages: [
    { label: 'Sort', key: 'sort', type: 'text', is_search: true },
    STATUS_COL(),
    { label: 'Package Code', key: 'package_type', type: 'text', is_search: true },
    { label: 'Code', key: 'code', type: 'text', is_search: true },
    { label: 'Description', key: 'description', type: 'text', is_search: true },
  ],
  // Laravel app/Models/Menu.php::formatTable
  menus: [
    { label: 'Status', key: 'status' },
    { label: 'Name', key: 'name' },
    { label: 'Url', key: 'url' },
  ],
};

export function setupTable(group: string): any[] {
  let name = 'Name';
  const labels: Record<string, string> = {
    cancelation: 'Cancelation',
    'guest-title': 'Title',
    'guest-status': 'Status',
    floor: 'Floor',
    building: 'Building',
    area: 'Area',
    'in-room-equipment': 'Item',
    'room-configuration': 'Room Configuration',
    'room-type-grouping': 'Room Type Grouping',
  };
  if (labels[group]) name = labels[group];
  else if (group) name = group.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  const table: any[] = [
    STATUS_COL(),
    ...(group === 'room-type-grouping'
      ? [{ label: 'No', key: 'sort', type: 'number', is_search: false }]
      : [NO_COL()]),
    { label: name, key: 'name', type: 'text', is_search: true },
  ];

  // Laravel Type::formatTable() parity — description hidden for these groups
  if (!['room-configuration', 'guest-title', 'guest-status', 'company-type', 'guest-type', 'market-segment-1', 'market-segment-2', 'market-segment-3', 'market-segment-4'].includes(group)) {
    table.push({ label: 'Description', key: 'description', type: 'text', is_search: true });
  }

  // Image (file_document) only for room-configuration
  if (group === 'room-configuration') {
    table.push({ label: 'Image', key: 'image', type: 'file_document', is_search: false });
  }

  // Area/template-floor-plan: Building + Floor selects (options injected by controller)
  if (group === 'area' || group === 'template-floor-plan') {
    table.push({ label: 'Building', key: 'building', type: 'select', options: [], is_search: true });
    table.push({ label: 'Floor', key: 'floor', type: 'select', options: [], is_search: true });
  }

  // template-floor-plan: SVG text column
  if (group === 'template-floor-plan') {
    table.push({ label: 'SVG', key: 'text', type: 'text', is_search: true });
  }

  // master-report: Group Report (select) + Action (select_multiple) — options injected by controller
  if (group === 'master-report') {
    table.push({ label: 'Group Report', key: 'group_report', type: 'select', options: [], is_search: true });
    table.push({ label: 'Action', key: 'action_report', type: 'select_multiple', options: [], is_search: true });
  }

  return table;
}

export function postCodeBudgetTable(year: number): any[] {
  const table: any[] = [{ label: 'Name', key: 'name', type: 'none', is_search: false }];
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  for (let i = 1; i <= 12; i++) {
    table.push({ label: monthNames[i - 1], key: 'month_' + i, type: 'number', is_search: false });
  }
  return table;
}