/**
 * Port of Laravel `Folio::formatAction()` plus the `cms.action_reservation`
 * config it reads, so the row action menu (`lines.png` popup in table-edit)
 * offers the same set of entries the Laravel app shows.
 *
 * Without this the front-desk folio rows shipped `actions: []`, which rendered
 * the popup as an empty box — clicking the lines button appeared to do nothing.
 */

/** config('cms.status_reservation') — id to code. */
const STATUS_CODE: Record<number, string> = {
  0: 'check_in',
  1: 'check_out',
  2: 'cancel_reservation',
  3: 'reservation',
  4: 'in_house',
  5: 'pending',
};

const STATUS_CANCEL_RESERVATION = 2;
const STATUS_CHECK_IN = 0;
const STATUS_RESERVATION = 3;
const STATUS_PENDING = 5;

type Action = { name: string; key: string; line?: boolean; icon: string };

/** config('cms.action_reservation.action') — order defines menu order. */
const ACTION_CATALOG: Action[] = [
  { key: 'fit', name: 'New FIT', icon: '/theme/cms/images/reservation/icon/New_Reservation.svg' },
  { key: 'git', name: 'New GIT', icon: '/theme/cms/images/reservation/icon/New_Reservation.svg' },
  { key: 'vr', name: 'New VR', icon: '/theme/cms/images/reservation/icon/New_Reservation.svg' },
  { key: 'edit', name: 'Edit', line: true, icon: '/theme/cms/images/reservation/icon/Edit_Reservation.svg' },
  { key: 'assign_room', name: 'Assign Room', icon: '/theme/cms/images/reservation/icon/Asign_room.svg' },
  { key: 'un_assign_room', name: 'Un Assign Room', icon: '/theme/cms/images/reservation/icon/Asign_room.svg' },
  { key: 'confirm_change_room', name: 'Confirm Change Room', icon: '/theme/cms/images/reservation/icon/Confirm_Reservation.svg' },
  { key: 'cancel_change_room', name: 'Cancel Change Room', line: true, icon: '/theme/cms/images/reservation/icon/Cancel_Reservation.svg' },
  { key: 'check_in', name: 'Check In', icon: '/theme/cms/images/reservation/icon/Checkin.svg' },
  { key: 'un_check_in', name: 'Un Check In', icon: '/theme/cms/images/reservation/icon/Checkin.svg' },
  { key: 'cancel_reservation', name: 'Cancel Reservation', icon: '/theme/cms/images/reservation/icon/Cancel_Reservation.svg' },
  { key: 'un_cancel_reservation', name: 'Un Cancel Reservation', icon: '/theme/cms/images/reservation/icon/Cancel_Reservation.svg' },
  { key: 'check_out', name: 'Check Out', icon: '/theme/cms/images/reservation/icon/Checkout.svg' },
  { key: 'un_check_out', name: 'Re-Check In', line: true, icon: '/theme/cms/images/reservation/icon/Checkout.svg' },
  { key: 'copy_reservation', name: 'Copy Reservation', line: true, icon: '/theme/cms/images/reservation/icon/Add_Message.svg' },
  { key: 'move_reservation', name: 'Move Reservation', line: true, icon: '/theme/cms/images/reservation/icon/Checkin.svg' },
  { key: 'confirm_reservation', name: 'Confirm Reservation', line: true, icon: '/theme/cms/images/reservation/icon/Add_Message.svg' },
  { key: 'add_message', name: 'Add Message', icon: '/theme/cms/images/reservation/icon/Add_Message.svg' },
  { key: 'view_message', name: 'View Message', icon: '/theme/cms/images/reservation/icon/View_Message.svg' },
  { key: 'add_remark', name: 'Add Remark', icon: '/theme/cms/images/reservation/icon/Add_Message.svg' },
  { key: 'view_remark', name: 'View Remark', icon: '/theme/cms/images/reservation/icon/View_Message.svg' },
  { key: 'new_key', name: 'New Key', icon: '/theme/cms/images/reservation/icon/Checkin.svg' },
  { key: 'duplicate_key', name: 'Duplicate Key', icon: '/theme/cms/images/reservation/icon/Checkin.svg' },
  { key: 'erase_key', name: 'Erase Key', icon: '/theme/cms/images/reservation/icon/Checkin.svg' },
  { key: 'check_out_view', name: 'Check Out View', icon: '/theme/cms/images/reservation/icon/Checkout.svg' },
  { key: 'confirmation_letter', name: 'Send Email Confirmation Letter', icon: '/theme/cms/images/reservation/icon/Checkout.svg' },
  { key: 'guest_invoice_all_billing', name: 'Send Email Guest Invoice All Billing', icon: '/theme/cms/images/reservation/icon/Checkout.svg' },
  { key: 'guest_invoice_ledger', name: 'Send Email Guest Invoice Ledger', icon: '/theme/cms/images/reservation/icon/Checkout.svg' },
];

/** config('cms.action_reservation.rule') — which keys each status code allows. */
const ACTION_RULE: Record<string, string[]> = {
  reservation: [
    'fit', 'git', 'vr', 'edit', 'move_reservation', 'assign_room', 'un_assign_room',
    'confirm_change_room', 'cancel_change_room', 'check_in', 'check_out_view',
    'cancel_reservation', 'copy_reservation', 'add_message', 'view_message',
    'add_remark', 'view_remark', 'confirmation_letter', 'guest_invoice_all_billing',
    'guest_invoice_ledger',
  ],
  check_in: [
    'fit', 'git', 'vr', 'edit', 'confirm_change_room', 'cancel_change_room', 'check_in',
    'un_check_in', 'check_out', 'check_out_view', 'copy_reservation', 'add_message',
    'view_message', 'add_remark', 'view_remark', 'new_key', 'duplicate_key', 'erase_key',
    'confirmation_letter', 'guest_invoice_all_billing', 'guest_invoice_ledger',
  ],
  check_out: [
    'fit', 'git', 'vr', 'edit', 'un_check_out', 'check_out_view', 'copy_reservation',
    'add_message', 'view_message', 'add_remark', 'view_remark', 'confirmation_letter',
    'guest_invoice_all_billing', 'guest_invoice_ledger',
  ],
  cancel_reservation: [
    'fit', 'git', 'vr', 'edit', 'copy_reservation', 'add_message', 'view_message',
    'add_remark', 'view_remark',
  ],
  default: [
    'fit', 'git', 'vr', 'edit', 'move_reservation', 'assign_room', 'un_assign_room',
    'confirm_change_room', 'cancel_change_room', 'check_in', 'un_check_in',
    'cancel_reservation', 'check_out_view', 'un_check_out_to_virtual', 'copy_reservation',
    'confirm_reservation', 'add_message', 'view_message', 'add_remark', 'view_remark',
    'confirmation_letter', 'guest_invoice_all_billing', 'guest_invoice_ledger',
  ],
};

const PENDING_ALLOWED = [
  'edit', 'cancel_reservation', 'confirm_reservation', 'copy_reservation',
  'add_message', 'view_message',
];

export type FormattedAction = { label: string; key: string; icon: string; line: boolean };

export interface FolioActionInput {
  status_reservation: number | null | undefined;
  type_reservation: string | null | undefined;
  is_pending?: boolean | null;
  /** Whether any reservation on this folio has a pending room change. */
  hasRoomChange?: boolean;
  /** Number of child folios still in `reservation` status. */
  childReservationCount?: number;
  check_in_date?: string | null;
  businessDate: string;
  /** `request()->group` — 'fit' / 'git' hide the check-in/out family. */
  group?: string | null;
  isParentGit?: boolean;
  isGit?: boolean;
  isFit?: boolean;
  nightAudit?: boolean;
  auditType?: string | null;
}

/**
 * Mirror of `Folio::formatAction()`. The predicate order matters: Laravel's
 * closure short-circuits on the first matching branch, so a pending folio never
 * reaches the status-rule check even though `pending` has no rule entry of its
 * own and would otherwise fall through to `default`.
 */
export function formatFolioActions(input: FolioActionInput): FormattedAction[] {
  const status = Number(input.status_reservation ?? -1);
  const type = String(input.type_reservation ?? '').toLowerCase();
  const businessDate = input.businessDate;

  if (input.nightAudit) {
    const allowed =
      input.auditType === 'room-change'
        ? ['confirm_change_room', 'edit', 'cancel_change_room']
        : input.auditType === 'no-show'
          ? ['cancel_reservation', 'edit']
          : input.auditType === 'over-stay'
            ? ['check_out', 'edit']
            : [];
    if (!allowed.length) return [];
    return ACTION_CATALOG.filter((a) => allowed.includes(a.key)).map(toFormatted);
  }

  const code = STATUS_CODE[status] ?? '';
  const rule = ACTION_RULE[code] ?? ACTION_RULE.default;
  const group = String(input.group ?? '').toLowerCase();
  const isParentGit = !!input.isParentGit;
  const isGit = type === 'git';
  const isFit = type === 'fit';
  // Folio::ispending() — the flag OR the pending status, not either alone.
  const isPending = !!input.is_pending || status === STATUS_PENDING;
  const checkInOnBusinessDate =
    !!input.check_in_date && String(input.check_in_date).slice(0, 10) === businessDate;

  return ACTION_CATALOG.filter((action) => {
    const key = action.key;

    if (key === 'confirm_change_room' || key === 'cancel_change_room') {
      if (!input.hasRoomChange) return false;
    }

    if (key === 'confirm_reservation' || key === 'cancel_reservation') {
      if (status === STATUS_CANCEL_RESERVATION) return false;
    }

    if (key === 'un_check_in') {
      if (!checkInOnBusinessDate) return false;
    }

    if (group === 'fit' || group === 'git') {
      if (key === 'check_in' || key === 'check_out' || key === 'un_check_in' || key === 'un_check_out') {
        return false;
      }
    }

    if (isParentGit && key === 'assign_room') return false;

    if (key === 'move_reservation' && isGit) return false;

    if (key === 'copy_reservation' && !isFit) return false;

    if (key === 'check_in' && status === STATUS_CHECK_IN) {
      if (!isParentGit) return false;
      if ((input.childReservationCount ?? 0) === 0) return false;
    }

    if (isPending) return PENDING_ALLOWED.includes(key);

    if (key === 'vr' || key === 'git' || key === 'fit') return key === type;

    return rule.includes(key);
  }).map(toFormatted);
}

function toFormatted(a: Action): FormattedAction {
  return { label: a.name, key: a.key, icon: a.icon, line: !!a.line };
}
