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